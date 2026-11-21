'use strict';
const { execFile } = require('child_process');

// Activate the top-level Windows window owned by the process that launched the hook.
// The PID comes from the local hook event, never from a browser supplied command or path.
function focusProcess(processIds) {
  if (process.platform !== 'win32') return Promise.reject(new Error('Window focus is currently supported on Windows only'));
  const pids = [...new Set((Array.isArray(processIds) ? processIds : [processIds])
    .filter(pid => Number.isSafeInteger(pid) && pid > 4))];
  if (!pids.length) return Promise.reject(new Error('invalid process id'));
  const pidList = pids.join(',');

  const script = String.raw`
$pids = @(${pidList})
$source = @'
using System;
using System.Runtime.InteropServices;
public static class ObserverWindow {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr extra);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr window, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("kernel32.dll")] public static extern bool FreeConsole();
  [DllImport("kernel32.dll")] public static extern bool AttachConsole(uint processId);
  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
  public delegate bool EnumWindowsProc(IntPtr window, IntPtr extra);
}
'@
Add-Type $source
$target = [IntPtr]::Zero
[ObserverWindow]::EnumWindows({ param($window, $extra)
  [uint32]$owner = 0
  [void][ObserverWindow]::GetWindowThreadProcessId($window, [ref]$owner)
  if ($pids -contains [int]$owner -and [ObserverWindow]::IsWindowVisible($window)) { $script:target = $window; return $false }
  return $true
}, [IntPtr]::Zero)
if ($target -eq [IntPtr]::Zero) {
  foreach ($candidate in $pids) {
    [void][ObserverWindow]::FreeConsole()
    if ([ObserverWindow]::AttachConsole([uint32]$candidate)) {
      $target = [ObserverWindow]::GetConsoleWindow()
      if ($target -ne [IntPtr]::Zero) { break }
    }
  }
}
if ($target -eq [IntPtr]::Zero) { throw 'No visible app or console window belongs to the session process ancestry' }
[void][ObserverWindow]::ShowWindowAsync($target, 9)
if (-not [ObserverWindow]::SetForegroundWindow($target)) { throw 'Windows did not allow the app window to take focus' }
`;

  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 5000 }, error => {
      if (error) reject(new Error('Could not focus the session window. The app may have closed or Windows may have blocked activation.'));
      else resolve();
    });
  });
}

module.exports = { focusProcess };
