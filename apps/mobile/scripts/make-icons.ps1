# Regenerates the launcher icons and splash screens from the in-app brand mark.
# Usage: powershell -ExecutionPolicy Bypass -File apps/mobile/scripts/make-icons.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$res = Join-Path $PSScriptRoot '..\android\app\src\main\res'
$ink = [System.Drawing.Color]::FromArgb(255, 7, 9, 15)
$warm = [System.Drawing.Color]::FromArgb(255, 247, 206, 143)
$cool = [System.Drawing.Color]::FromArgb(255, 127, 164, 242)
$dark = [System.Drawing.Color]::FromArgb(235, 7, 9, 15)

function New-RoundedPath([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function Draw-Lens($g, [single]$cx, [single]$cy, [single]$tile, [bool]$glow = $true) {
  # A smooth radial halo keeps the mark from reading as a flat sticker.
  if ($glow) {
    $haloRadius = $tile * 0.95
    $haloPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $haloPath.AddEllipse($cx - $haloRadius, $cy - $haloRadius, $haloRadius * 2, $haloRadius * 2)
    $halo = [System.Drawing.Drawing2D.PathGradientBrush]::new($haloPath)
    $halo.CenterColor = [System.Drawing.Color]::FromArgb(34, 242, 192, 120)
    $halo.SurroundColors = [System.Drawing.Color[]]@([System.Drawing.Color]::FromArgb(0, 242, 192, 120))
    $g.FillPath($halo, $haloPath)
    $halo.Dispose()
    $haloPath.Dispose()
  }

  $x = $cx - $tile / 2
  $y = $cy - $tile / 2
  $rect = [System.Drawing.RectangleF]::new($x, $y, $tile, $tile)
  $path = New-RoundedPath $x $y $tile $tile ($tile * 0.34)
  $brush = [System.Drawing.Drawing2D.LinearGradientBrush]::new($rect, $warm, $cool, 145)
  $g.FillPath($brush, $path)

  $edge = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(120, 255, 255, 255), [single]($tile * 0.018))
  $g.DrawPath($edge, $path)

  $ring = $tile * 0.5625
  $ringPen = [System.Drawing.Pen]::new($dark, [single]($tile * 0.05))
  $g.DrawEllipse($ringPen, $cx - $ring / 2, $cy - $ring / 2, $ring, $ring)

  $dot = $tile * 0.14
  $dotOffset = $tile * 0.17
  $dotBrush = [System.Drawing.SolidBrush]::new($dark)
  $g.FillEllipse($dotBrush, $cx + $dotOffset - $dot / 2, $cy + $dotOffset - $dot / 2, $dot, $dot)

  $brush.Dispose()
  $path.Dispose()
  $edge.Dispose()
  $ringPen.Dispose()
  $dotBrush.Dispose()
}

function Save-Icon([int]$size, [string]$path, [bool]$round) {
  $bmp = [System.Drawing.Bitmap]::new($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  if ($round) {
    $clip = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $clip.AddEllipse(0, 0, $size, $size)
    $g.SetClip($clip)
    $clip.Dispose()
  }
  $bg = [System.Drawing.SolidBrush]::new($ink)
  $g.FillRectangle($bg, 0, 0, $size, $size)
  $bg.Dispose()
  Draw-Lens $g ($size / 2) ($size / 2) ($size * 0.66) $false
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
}

function Save-Foreground([int]$size, [string]$path) {
  $bmp = [System.Drawing.Bitmap]::new($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  Draw-Lens $g ($size / 2) ($size / 2) ($size * 0.56)
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
}

function Save-Splash([int]$width, [int]$height, [string]$path) {
  $bmp = [System.Drawing.Bitmap]::new($width, $height)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear($ink)

  # One warm horizon, matching the app's aurora rather than a flat black screen.
  $glow = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    [System.Drawing.Rectangle]::new(0, 0, $width, $height),
    [System.Drawing.Color]::FromArgb(26, 242, 192, 120),
    [System.Drawing.Color]::FromArgb(0, 242, 192, 120),
    90
  )
  $g.FillRectangle($glow, 0, 0, $width, $height)
  $glow.Dispose()

  Draw-Lens $g ($width / 2) ($height / 2) ([Math]::Min($width, $height) * 0.22)
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
}

$densities = @{
  'mdpi'    = 1.0
  'hdpi'    = 1.5
  'xhdpi'   = 2.0
  'xxhdpi'  = 3.0
  'xxxhdpi' = 4.0
}

foreach ($entry in $densities.GetEnumerator()) {
  $dir = Join-Path $res "mipmap-$($entry.Key)"
  $scale = $entry.Value
  Save-Icon ([int](48 * $scale)) (Join-Path $dir 'ic_launcher.png') $false
  Save-Icon ([int](48 * $scale)) (Join-Path $dir 'ic_launcher_round.png') $true
  Save-Foreground ([int](108 * $scale)) (Join-Path $dir 'ic_launcher_foreground.png')
}

$splashes = @(
  @{ W = 480;  H = 320;  Dir = 'drawable' },
  @{ W = 480;  H = 320;  Dir = 'drawable-land-mdpi' },
  @{ W = 800;  H = 480;  Dir = 'drawable-land-hdpi' },
  @{ W = 1280; H = 720;  Dir = 'drawable-land-xhdpi' },
  @{ W = 1600; H = 960;  Dir = 'drawable-land-xxhdpi' },
  @{ W = 1920; H = 1280; Dir = 'drawable-land-xxxhdpi' },
  @{ W = 320;  H = 480;  Dir = 'drawable-port-mdpi' },
  @{ W = 480;  H = 800;  Dir = 'drawable-port-hdpi' },
  @{ W = 720;  H = 1280; Dir = 'drawable-port-xhdpi' },
  @{ W = 960;  H = 1600; Dir = 'drawable-port-xxhdpi' },
  @{ W = 1280; H = 1920; Dir = 'drawable-port-xxxhdpi' }
)

foreach ($s in $splashes) {
  Save-Splash $s.W $s.H (Join-Path $res "$($s.Dir)\splash.png")
}

Write-Host "Icons and splash screens regenerated in $res"
