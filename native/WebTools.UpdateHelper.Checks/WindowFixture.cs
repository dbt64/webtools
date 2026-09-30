namespace WebTools.UpdateHelper.Checks;

internal static class WindowFixture
{
    internal static void Run()
    {
        var thread = new Thread(() =>
        {
            using var window = new System.Windows.Forms.Form
            {
                Text = "WebTools Update Check Fixture",
                ShowInTaskbar = false,
                Opacity = 0,
            };
            window.Shown += (_, _) =>
            {
                Console.WriteLine("READY");
                _ = Task.Run(() =>
                {
                    Console.ReadLine();
                    try { window.BeginInvoke(new Action(window.Close)); }
                    catch (InvalidOperationException) { }
                });
            };
            System.Windows.Forms.Application.Run(window);
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();
    }
}
