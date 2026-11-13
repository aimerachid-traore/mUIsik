# Place une fenêtre derrière les icônes du bureau (fond d'écran animé), ou restaure le fond Windows.
# Usage : desktop.ps1 attach <hwnd> <x> <y> <w> <h>   (coordonnées physiques, en pixels)
#         desktop.ps1 restore
param([string]$Action, [long]$Hwnd = 0, [int]$X = 0, [int]$Y = 0, [int]$W = 0, [int]$H = 0)

Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class MuisikDesktop {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr FindWindow(string c, string n);
  [DllImport("user32.dll")] static extern IntPtr FindWindowEx(IntPtr p, IntPtr after, string c, string n);
  [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h, uint m, IntPtr w, IntPtr l, uint f, uint t, out IntPtr r);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr SetParent(IntPtr c, IntPtr p);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW")] static extern IntPtr SetWindowLongPtr(IntPtr h, int i, IntPtr v);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool SystemParametersInfo(uint a, uint p, StringBuilder v, uint f);

  const int GWL_STYLE = -16;
  const long WS_CHILD = 0x40000000L, WS_POPUP = 0x80000000L, WS_CAPTION = 0x00C00000L, WS_THICKFRAME = 0x00040000L;
  const uint SWP_NOACTIVATE = 0x0010, SWP_SHOWWINDOW = 0x0040, SWP_FRAMECHANGED = 0x0020;

  public static string Attach(long hwndL, int x, int y, int w, int h) {
    // Sans ça, Windows "virtualise" les coordonnées et une bande du fond d'origine reste visible.
    SetProcessDpiAwarenessContext(new IntPtr(-4));
    IntPtr hwnd = new IntPtr(hwndL);
    IntPtr progman = FindWindow("Progman", null);
    IntPtr res;
    // Demande à l'Explorateur de créer la couche WorkerW située derrière les icônes.
    SendMessageTimeout(progman, 0x052C, new IntPtr(0xD), new IntPtr(0x1), 0, 1000, out res);
    SendMessageTimeout(progman, 0x052C, IntPtr.Zero, IntPtr.Zero, 0, 1000, out res);

    int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77);
    int rx = x - vx, ry = y - vy;

    long style = GetWindowLongPtr(hwnd, GWL_STYLE).ToInt64();
    style = (style | WS_CHILD) & ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME);

    // Windows 11 24H2+ : le WorkerW est un enfant de Progman, on s'insère juste sous SHELLDLL_DefView.
    IntPtr defView = FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
    IntPtr childWorker = FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);
    if (defView != IntPtr.Zero && childWorker != IntPtr.Zero) {
      SetWindowLongPtr(hwnd, GWL_STYLE, new IntPtr(style));
      SetParent(hwnd, progman);
      SetWindowPos(hwnd, defView, rx, ry, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED);
      return "ok:progman";
    }

    // Avant 24H2 : WorkerW de premier niveau qui suit celui contenant SHELLDLL_DefView.
    IntPtr worker = IntPtr.Zero;
    EnumWindows((top, l) => {
      if (FindWindowEx(top, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero)
        worker = FindWindowEx(IntPtr.Zero, top, "WorkerW", null);
      return true;
    }, IntPtr.Zero);
    if (worker == IntPtr.Zero) return "error:no-workerw";
    SetWindowLongPtr(hwnd, GWL_STYLE, new IntPtr(style));
    SetParent(hwnd, worker);
    SetWindowPos(hwnd, IntPtr.Zero, rx, ry, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED);
    return "ok:workerw";
  }

  public static string Restore() {
    // Ré-applique le fond d'écran actuel pour effacer la dernière image laissée par mUIsik.
    var sb = new StringBuilder(520);
    SystemParametersInfo(0x0073, 520, sb, 0);
    SystemParametersInfo(0x0014, 0, sb, 0x01 | 0x02);
    return "ok";
  }
}
"@

if ($Action -eq 'attach') { [MuisikDesktop]::Attach($Hwnd, $X, $Y, $W, $H) }
elseif ($Action -eq 'restore') { [MuisikDesktop]::Restore() }
else { 'error:usage' }
