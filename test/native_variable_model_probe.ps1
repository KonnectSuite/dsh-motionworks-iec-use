param([Parameter(Mandatory=$true)][string]$ExpectedProject)
$ErrorActionPreference='Stop'
$app=New-Object -ComObject Ade.Application.550
if(-not $app.IsProjectOpen() -or [IO.Path]::GetFullPath($app.ActiveProject.FullName) -ine [IO.Path]::GetFullPath($ExpectedProject)){throw 'Wrong open project'}
$pou=$null
for($i=1;$i -le $app.ActiveProject.Pous.Count;$i++){ $p=$app.ActiveProject.Pous.Item($i); if($p.Name -eq 'TopCutterCutControl'){$pou=$p} }
$resource=$app.ActiveProject.GetObjectByLogicalName('Hardware/Configuration/Resource',10)
foreach($scope in @(@{name='local';vars=$pou.Variables},@{name='global';vars=$resource.Variables})){
 $vs=$scope.vars
 $groups=@()
 for($i=1;$i -le $vs.Groups.Count;$i++){$g=$vs.Groups.Item($i);$groups+=@{name=[string]$g.Name;path=[string]$g.GroupPath}}
 $v=$vs.Item(1)
 @{scope=$scope.name;count=$vs.Count;groups=$groups;sample=@{name=[string]$v.Name;group=[string]$v.Group.Name;group_path=[string]$v.GroupPath;type=[string]$v.DataType;section=[int]$v.BlockType;description=[string]$v.Comment;retain=[bool]$v.Retain}} | ConvertTo-Json -Depth 5 -Compress
}
