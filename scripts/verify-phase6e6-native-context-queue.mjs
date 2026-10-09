// Focused CLR probe of the actual Native queue, compiled only in a disposable TEMP project.
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = await mkdtemp(join(tmpdir(), 'WebTools Phase6E6 Native Queue '))
const xml = value => value.replaceAll('&','&amp;').replaceAll('"','&quot;')
await writeFile(join(root,'Probe.csproj'), `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0-windows</TargetFramework><UseWPF>true</UseWPF><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable></PropertyGroup><ItemGroup><ProjectReference Include="${xml(join(repo,'native','WebTools.NativeHost','WebTools.NativeHost.csproj'))}" /></ItemGroup></Project>`)
await writeFile(join(root,'Program.cs'), `using WebTools.NativeHost.Services;
using WebTools.NativeHost.Data;
var clock = new FakeClock();
var constructor = typeof(NativeFeatureInvocationQueue).GetConstructor([typeof(TimeProvider)]) ?? throw new Exception("Queue has no bounded context expiry clock");
NativeFeatureInvocationQueue Make() => (NativeFeatureInvocationQueue)constructor.Invoke([clock]);
NativeFeatureInvocationRequest Request(long age = 0, bool context = true) => new(Guid.NewGuid().ToString("D"), new("org.example.probe", "hello"), "launcher",
 context ? new("text", "launcher-input", "SYNTHETIC-TEXT", clock.GetUtcNow().ToUnixTimeMilliseconds() - age) : null);
void Check(bool value, string message) { if (!value) throw new Exception(message); }
var first = Make(); Check(first.TryEnqueue(Request()) == NativeFeatureInvocationEnqueueResult.Enqueued, "enqueue");
clock.Advance(29999); Check(first.Peek()?.Context?.Text == "SYNTHETIC-TEXT", "premature expiry");
clock.Advance(1); Check(first.Count == 0 && first.Peek() is null && clock.Active == 0, "context retained beyond original TTL");
Console.WriteLine("PASS original 30-second deadline releases queue text and timer");
var aged = Make(); Check(aged.TryEnqueue(Request(10000)) == NativeFeatureInvocationEnqueueResult.Enqueued, "aged enqueue");
clock.Advance(19999); Check(aged.Count == 1, "aged premature expiry"); clock.Advance(1); Check(aged.Count == 0, "capture deadline was reset");
Console.WriteLine("PASS original capture age is retained rather than reset on enqueue");
var cleanup = Make(); var pending = Request(); cleanup.TryEnqueue(pending); Check(clock.Active == 1, "one timer expected");
Check(cleanup.Complete(pending.RequestId), "complete"); Check(clock.Active == 0, "complete leaked timer");
cleanup.TryEnqueue(Request()); cleanup.Clear(); Check(clock.Active == 0 && cleanup.Count == 0, "clear leaked context/timer");
cleanup.TryEnqueue(Request(context:false)); clock.Advance(600000); Check(cleanup.Count == 1 && clock.Active == 0, "legacy no-context queue changed"); cleanup.Clear();
Console.WriteLine("PASS completion/clear cancel timers; legacy requests remain unchanged");
var bounded = Make(); Check(bounded.TryEnqueue(Request(30000)) == NativeFeatureInvocationEnqueueResult.InvalidRequest, "expired accepted");
Check(bounded.TryEnqueue(Request(-1)) == NativeFeatureInvocationEnqueueResult.InvalidRequest, "future accepted");
var duplicate = Request(); Check(bounded.TryEnqueue(duplicate) == NativeFeatureInvocationEnqueueResult.Enqueued, "valid enqueue");
Check(bounded.TryEnqueue(duplicate) == NativeFeatureInvocationEnqueueResult.DuplicateRequest, "duplicate accepted");
for(var i=1;i<4;i++) bounded.TryEnqueue(Request()); Check(clock.Active == 1, "timer stacking");
Check(bounded.TryEnqueue(Request()) == NativeFeatureInvocationEnqueueResult.QueueFull, "unbounded queue"); bounded.Clear(); Check(clock.Active == 0, "final cleanup");
Console.WriteLine("PASS invalid age, duplicate, capacity and single-timer invariants");
Console.WriteLine("4/4 Native context queue checks passed.");
sealed class FakeClock : TimeProvider {
 long milliseconds; readonly List<FakeTimer> timers = new();
 public int Active => timers.Count(t => !t.Disposed);
 public override DateTimeOffset GetUtcNow() => DateTimeOffset.FromUnixTimeMilliseconds(100000 + milliseconds);
 public override long GetTimestamp() => milliseconds;
 public override long TimestampFrequency => 1000;
 public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period) { var timer=new FakeTimer(this,callback,state); timers.Add(timer); timer.Change(dueTime,period); return timer; }
 public void Advance(long amount) { milliseconds+=amount; foreach(var timer in timers.ToArray()) if(!timer.Disposed && timer.Due<=milliseconds) timer.Fire(); }
 sealed class FakeTimer(FakeClock clock, TimerCallback callback, object? state) : ITimer {
  public bool Disposed; public long Due;
  public bool Change(TimeSpan dueTime, TimeSpan period) { if(Disposed)return false; Due=dueTime==Timeout.InfiniteTimeSpan?long.MaxValue:clock.milliseconds+(long)dueTime.TotalMilliseconds; return true; }
  public void Fire() { Due=long.MaxValue; callback(state); }
  public void Dispose() => Disposed=true;
  public ValueTask DisposeAsync() { Dispose(); return ValueTask.CompletedTask; }
 }
}
`)
const result = spawnSync('dotnet', ['run','--project',join(root,'Probe.csproj'),'-c','Release'], { cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 2*1024*1024 })
await writeFile(join(root,'result.log'), result.stdout + result.stderr)
console.log(result.stdout + result.stderr)
console.log(`Evidence: ${root}`)
assert.equal(result.status, 0, 'Native context queue probe failed')
