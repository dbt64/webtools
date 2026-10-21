using WebTools.NativeHost.Services;

namespace WebTools.NativeHost.Checks;

internal static class ElectronHostOwnershipChecks
{
    internal static void Run()
    {
        var state = new ElectronHostOwnership();
        void Check(bool valid) { if (!valid) throw new InvalidOperationException("Host ownership transition failed."); }
        Check(!state.HasOwners);
        state.BeginSession("old"); state.BeginSession("new");
        var revision = state.Revision;
        state.BeginSession("new"); Check(state.Revision == revision);
        state.EndSession("old"); state.EndSession("old");
        Check(state.HasOwners && state.Snapshot().SessionIds.SequenceEqual(new[] { "new" }));
        state.Acquire("selected"); state.EndSession("new");
        Check(state.HasOwners && state.Snapshot().Requests.Single().State == "queued");
        state.Delivered("selected"); Check(state.Snapshot().Requests.Single().State == "delivered");
        state.BeginSession("next"); state.Complete("selected");
        Check(state.HasOwners && state.Snapshot().Requests.Length == 0);
        state.EndSession("next"); Check(!state.HasOwners);
    }
}
