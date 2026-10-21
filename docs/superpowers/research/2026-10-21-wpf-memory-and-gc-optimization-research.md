# WPF / .NET 内存增长与 GC 优化研究

日期：2026-10-21\
范围：微软官方 .NET / WPF 文档、微软诊断工具文档与当前 WebTools NativeHost 源码静态检查。**没有修改产品代码，没有运行测试或采集本机内存数据。**

## 结论

目前的“90–100 MB”不能直接说明 WPF 的 GC 回收迟钝。必须先确认看到的是哪个进程、哪个内存指标，再判断增长属于托管对象、GC 已保留的堆段、WPF/Windows 原生资源，还是同时运行的 Electron 进程。`WorkingSet64`、`PrivateMemorySize64` 与 GC Heap 是不同指标；微软的 GC 排查指引也要求先把工作集与托管堆分开。如果增长不在托管堆里，就应转向原生内存诊断。[GC 性能排查](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/performance) · [WorkingSet64](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process.workingset64?view=net-10.0) · [PrivateMemorySize64](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process.privatememorysize64?view=net-10.0)

源码显示，搜索框会建立并保留应用搜索索引；打开插件时 WPF 窗口只调用 `Hide()`，NativeHost、窗口对象和索引仍然存活。这会让初次搜索或目录刷新后占用上升，并在 WPF 待命期间保留一部分内存。这是当前架构的驻留行为，不能仅凭数字判为泄漏。另一方面，插件由独立 Electron 进程运行；只看任务管理器里聚合的 WebTools 进程组，无法判断是哪边增长。

因此，当前最可信的方案是**按 PID 同时采集工作集、私有字节和 GC 堆指标，重复相同的搜索/开插件/关闭流程，只有确认托管堆持续增长后才检查对象引用链**。不建议先改 GC 模式，也不建议在搜索、隐藏或关闭窗口时调用 `GC.Collect()`。

## 官方资料给出的可复用案例

| 问题类型 | 微软文档中的做法 | 对 WebTools 的适用性 |
| --- | --- | --- |
| 大型 WPF 列表创建过多视觉对象 | `VirtualizingStackPanel` 只为可视项目生成容器；`VirtualizationMode=Recycling` 复用容器。UI 虚拟化不会释放仍绑定的完整数据集合；`CanContentScroll=false`、直接加入容器等设置也会关闭虚拟化。[WPF 控件优化](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/advanced/optimizing-performance-controls) | 对几百/几千项的列表很有效。WebTools 搜索结果当前限制为最多 8 个应用结果和最多 6 个插件结果，普通搜索列表不是优先怀疑对象；文件列表和 Super Panel 大列表更值得确认虚拟化是否仍生效。 |
| 图像按原尺寸解码但只显示小图 | 微软的 `BitmapImage` 示例指出，不限制解码尺寸时，应用可能缓存原图；设定 `DecodePixelWidth` 或 `DecodePixelHeight` 可显著降低图像占用。[BitmapImage 内存示例](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/graphics-multimedia/how-to-use-a-bitmapimage) | 检查图像源像素尺寸、解码尺寸和缓存边界。当前 WebTools 的网站图标解码宽度为 64px，主窗口一处图标为 256px；常规 Shell 小图标走 `SHGFI_SMALLICON`。这些路径已经有尺寸限制，仍需用字节指标证实是否占大头。 |
| 短生命周期窗口被长生命周期对象保留 | 普通事件订阅会建立 source→listener 的强引用；长生命周期源未解除订阅，可能让窗口或控件继续存活。WPF 弱事件模式适用于源对象寿命长于监听者、且监听者不便明确注销的场景。[WPF 弱事件模式](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/events/weak-event-patterns) | 重复开关若导致对象数持续增加，应查看 `gcroot` 和静态事件、计时器、Dispatcher、`CompositionTarget.Rendering` 等订阅的解绑路径。WPF 的很多数据绑定已使用弱事件，不要把所有绑定机械改成 WeakEventManager。 |
| 搜索索引、图标或模型缓存无限增长 | 缓存提升重复访问速度，但需要明确淘汰/容量策略；微软 WPF 缓存演示建议明确设置过期或滑动期限。[WPF 缓存演示](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/advanced/walkthrough-caching-application-data-in-a-wpf-application) | WebTools 的图标缓存已有 64 项 LRU 上限，投影图标和网站 favicon 也有来源尺寸限制。后续应验证实际缓存字节与增长趋势，而不是再叠加一层缓存。 |
| 大对象堆 / 大型图像或数组 | LOH 大对象的分配需要清零，通常与 Gen 2 一起回收；反复创建大型临时对象可能增加分配与 Gen 2 压力。[LOH 说明](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/large-object-heap) | 仅当快照显示大型 `byte[]`、图像缓冲或 LOH 增长时再处理。当前资料没有证明 NativeHost 在普通搜索中反复生成大对象。 |

## GC 行为与不应先做的调整

1. GC 回收的是从静态字段、线程栈、GC handle 等根对象不可达的托管对象。被缓存、绑定或事件委托继续引用的对象仍然存活；这不是 GC “慢”。[GC 基本原理](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/fundamentals)
2. 回收后的托管堆空间可供进程后续分配使用；`Working Set`、`Private Bytes` 和托管堆不是同一个指标，GC 不保证这些外部指标在一次回收后立即回落。`GC.GetTotalMemory(false)` 估算当前托管堆中的已分配对象字节数且不包含碎片；`GCMemoryInfo.HeapSizeBytes` / `FragmentedBytes` 反映最近一次 GC 的信息，读取时要保留各自语义。[GetTotalMemory](https://learn.microsoft.com/en-us/dotnet/api/system.gc.gettotalmemory) · [GCMemoryInfo.FragmentedBytes](https://learn.microsoft.com/en-us/dotnet/api/system.gcmemoryinfo.fragmentedbytes)
3. 显式 `GC.Collect()` 在绝大多数应用场景并非必要，微软将其主要定位为特殊场景和测试。频繁强制完整回收会带来暂停，且无法清除仍被引用的缓存对象；也不能保证把工作集降到基线。[GC 基本原理](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/fundamentals)
4. `.NET` 默认使用 Workstation GC；当前 `WebTools.NativeHost.csproj` 没有显式设置 `ServerGarbageCollection`。Server GC 主要面向吞吐型服务，不能作为 WPF 客户端的默认降内存办法。低延迟模式会让 GC 更保守、减少回收侵入性，可能保留更多内存；不适合为了压低搜索框占用而全局开启。[GC 配置](https://learn.microsoft.com/en-us/dotnet/core/runtime-config/garbage-collector) · [GC 延迟模式](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/latency)

## WebTools NativeHost 的静态代码观察

以下是**代码路径观察，不是内存实测或泄漏结论**：

1. NativeHost 是 `net10.0-windows` WPF 应用。启动时创建常驻 `MainWindow`；打开 Electron 插件时 `HideLauncher()` 调用 WPF `Hide()`，而不是销毁窗口。因此搜索状态、搜索索引、结果数据和 WPF 对象仍可被 NativeHost 引用。[`WebTools.NativeHost.csproj`](../../../native/WebTools.NativeHost/WebTools.NativeHost.csproj) · [`MainWindow.xaml.cs`](../../../native/WebTools.NativeHost/MainWindow.xaml.cs#L592-L600)
2. `AppCatalogSnapshotStore` 限制目录最多 6000 个应用；`SearchCore` 为应用、网站和插件功能构建 `IndexedEntry[]`，其中预存规范化名称、别名、全文和拼音字段。目录加载或更新时会构建新的 `SearchCore`。这属于当前搜索性能设计的常驻数据，可能解释首次使用/刷新后的稳定堆增长；新旧索引短暂重叠也值得在采样中观察。[`AppCatalogSnapshotStore.cs`](../../../native/WebTools.NativeHost/Catalog/AppCatalogSnapshotStore.cs#L8-L13) · [`SearchCore.cs`](../../../native/WebTools.NativeHost/Search/SearchCore.cs#L20-L29) · [`MainWindow.xaml.cs`](../../../native/WebTools.NativeHost/MainWindow.xaml.cs#L485-L500)
3. 普通搜索只呈现前 8 个应用/网站结果及最多 6 个插件功能结果；文件搜索列表明确启用 WPF UI 虚拟化和容器回收。只对普通结果 ListBox 增加虚拟化配置，预计不会解释几十 MB 的稳定增长。[`SearchCore.cs`](../../../native/WebTools.NativeHost/Search/SearchCore.cs#L72-L95) · [`MainWindow.xaml`](../../../native/WebTools.NativeHost/MainWindow.xaml#L347-L363)
4. `NativeIconCache` 默认最多保留 64 项 LRU，并能报告近似 Bitmap 字节；缓存按**项数**限制，不按**总字节**限制，因此可以先看现有 `IconCacheCount` 和 `IconCacheBitmapBytes` 是否随重复操作持续增长。网站 favicon 解码至 64 像素，项目图标读取也对输入尺寸有限制。[`NativeIconCache.cs`](../../../native/WebTools.NativeHost/Services/NativeIconCache.cs#L12-L35) · [`WebsiteFaviconReader.cs`](../../../native/WebTools.NativeHost/Data/WebsiteFaviconReader.cs#L20-L40)
5. 已有受控资源诊断快照包含 `GC.GetTotalMemory(false)`、最近 GC 的 heap size / fragmentation，以及图标缓存计数/近似字节；它没有同时提供 Private Bytes 与 Working Set。已有进程采样脚本能记录这两个进程指标，但其入口要求测试根目录位于用户 TEMP，和此前约定的 `D:\SystemDefault\Desktop\webtoolstest` 不兼容。**本次没有运行该脚本，也没有向 C 盘写入测试数据**；后续若采用该采样脚本，需先调整输出根目录约束。[`Phase4EResourceControlServer.cs`](../../../native/WebTools.NativeHost/Diagnostics/Phase4EResourceControlServer.cs#L297-L321) · [`measure-plugin-runtime-processes.ps1`](../../../scripts/measure-plugin-runtime-processes.ps1#L1-L20)

## 建议的测量与优化顺序

所有采样、快照和日志放在 `D:\SystemDefault\Desktop\webtoolstest\wpf-memory-optimization-20261021`；不要以任务管理器聚合项代替单 PID 数据。

1. 用当前已打包版本确认 NativeHost PID、Electron 主进程 PID 与其 Chromium 子进程 PID。基线阶段分别记 NativeHost 与 Electron，不将 Electron 的占用记到 WPF。
2. 对同一个 NativeHost PID 依次标记：冷启动后空闲、唤出搜索框、输入常见中文/英文查询、重复搜索、打开插件（WPF 隐藏期间）、关闭插件并返回、等待 30–60 秒。至少重复数轮，比较每次循环后的稳定值，而非只看首次峰值。
3. 同时间采集 Private Bytes、Working Set、GC Heap Size、GC committed、Gen 0/1/2 次数、LOH/POH、分配速率和 GC 时间；`dotnet-counters` 的 `System.Runtime` 提供 GC heap 与 working-set 等指标。[dotnet-counters](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-counters) · [System.Runtime counters](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/available-counters)
4. 如果重复循环后托管堆仍单调增长，再在相同场景前后采集 `.gcdump` 比较对象类型与根引用；`dotnet-gcdump` 会触发 Gen 2 GC，所以采集时的内存不能当作未经探测的自然曲线。若需要 `gcroot`，使用 `dotnet-dump` 的 `dumpheap -stat` / `gcroot` 检查保留路径。[dotnet-gcdump](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-gcdump) · [dotnet-dump](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-dump)
5. 如果 GC heap 稳定、Private Bytes 或 Working Set 上升，则改用 VMMap 看 committed memory 类型和工作集分布，并结合 WPF 图像、图形资源与 GDI/USER handle 变化定位原生侧成本；不要靠 GC 参数处理非托管增长。[VMMap](https://learn.microsoft.com/en-us/sysinternals/downloads/vmmap)
6. 优化只针对测到的来源：搜索索引若是主要稳定占用，再权衡索引字段/拼音是否按需生成或是否需缩减重复字符串；图标若占主导，再以字节预算约束缓存；若有对象被意外保留，沿根引用修复生命周期。没有证据前不清空搜索索引、不缩短缓存、不牺牲下一次搜索速度。

## 资料清单

- [.NET GC 基本原理](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/fundamentals)
- [GC 性能与进程内存排查](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/performance)
- [GC 配置与默认模式](https://learn.microsoft.com/en-us/dotnet/core/runtime-config/garbage-collector)
- [GC 延迟模式](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/latency)
- [WPF 控件虚拟化与容器回收](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/advanced/optimizing-performance-controls)
- [WPF `BitmapImage` 解码尺寸与内存](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/graphics-multimedia/how-to-use-a-bitmapimage)
- [WPF 弱事件模式](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/events/weak-event-patterns)
- [WPF 缓存过期示例](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/advanced/walkthrough-caching-application-data-in-a-wpf-application)
- [LOH 行为](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/large-object-heap)
- [可用 .NET EventCounters](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/available-counters)
- [dotnet-counters](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-counters)、[dotnet-gcdump](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-gcdump)、[dotnet-dump](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-dump)
- [Microsoft Sysinternals VMMap](https://learn.microsoft.com/en-us/sysinternals/downloads/vmmap)
