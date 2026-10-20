$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$records = foreach ($file in Get-ChildItem -LiteralPath "$projectRoot/public/maps-layered-webp" -Recurse -Filter '*overlays-mm.svg') {
    [xml]$svg = Get-Content -Raw -LiteralPath $file.FullName
    $groups = $svg.SelectNodes('//*[local-name()="g"]') | Where-Object { $_.id -match '(^|-)bw$|(^|-)ch$' }
    $shapes = foreach ($group in $groups) {
        foreach ($shape in $group.SelectNodes('.//*[local-name()="path" or local-name()="rect"]')) {
            $transforms = [System.Collections.Generic.List[string]]::new()
            $hidden = $false
            for ($parent = $shape; $parent -and $parent.LocalName -ne 'svg'; $parent = $parent.ParentNode) {
                if ($parent.transform) { $transforms.Insert(0, [string]$parent.transform) }
                if ($parent.display -eq 'none' -or $parent.style -match 'display\s*:\s*none') { $hidden = $true }
            }
            if (-not $hidden) {
                [ordered]@{ id = [string]$shape.id; kind = $(if ($group.id -match 'bw$') { 'wall' } else { 'hatch' }); tag = $shape.LocalName; fill = [string]$shape.fill; d = [string]$shape.d; x = [string]$shape.x; y = [string]$shape.y; width = [string]$shape.width; height = [string]$shape.height; transforms = @($transforms) }
            }
        }
    }
    [ordered]@{ source = '/' + $file.FullName.Substring(($projectRoot + '/public/').Length).Replace('\', '/'); viewBox = [string]$svg.DocumentElement.viewBox; shapes = @($shapes) }
}
ConvertTo-Json -InputObject @($records) -Depth 8 -Compress
