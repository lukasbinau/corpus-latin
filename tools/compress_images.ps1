# Shrink every image in docs/img to a JPEG of at most 520x640 on a white background.
# Animated GIFs keep their first frame. Uses only Windows' built-in System.Drawing.
#
# Usage (from the project root): powershell -NoProfile -File tools/compress_images.ps1
param([string]$Dir = "docs/img", [int]$MaxWidth = 520, [int]$MaxHeight = 640, [long]$Quality = 82)

Add-Type -AssemblyName System.Drawing
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object System.Drawing.Imaging.EncoderParameters 1
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality, $Quality)

$files = Get-ChildItem $Dir -File | Where-Object { $_.Extension -in '.png', '.gif', '.jpg', '.jpeg' }
foreach ($f in $files) {
    $src = [System.Drawing.Image]::FromFile($f.FullName)
    $scale = [Math]::Min(1.0, [Math]::Min($MaxWidth / $src.Width, $MaxHeight / $src.Height))
    $w = [Math]::Max(1, [int]($src.Width * $scale))
    $h = [Math]::Max(1, [int]($src.Height * $scale))
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::White)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($src, 0, 0, $w, $h)
    $g.Dispose()
    $src.Dispose()
    $out = Join-Path $f.DirectoryName ($f.BaseName + '.jpg')
    $tmp = "$out.tmp"
    $bmp.Save($tmp, $codec, $params)
    $bmp.Dispose()
    if ($f.Extension -ne '.jpg') { Remove-Item $f.FullName }
    Move-Item -Force $tmp $out
}
"Compressed $($files.Count) images"
