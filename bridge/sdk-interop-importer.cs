using System; using System.IO; using System.Reflection; using System.Reflection.Emit;
using System.Runtime.InteropServices; using System.Runtime.InteropServices.ComTypes;
using System.Collections.Generic;
public class MwSdkInteropImporter : ITypeLibImporterNotifySink {
 [DllImport("oleaut32.dll",CharSet=CharSet.Unicode)] static extern int LoadTypeLibEx(string file,int kind,out ITypeLib lib);
 readonly string directory; readonly Dictionary<string,Assembly> imports=new Dictionary<string,Assembly>();
 public readonly List<string> Notices=new List<string>();
 public MwSdkInteropImporter(string dir){directory=dir;}
 public void ReportEvent(ImporterEventKind kind,int code,string text){if(kind!=ImporterEventKind.NOTIF_TYPECONVERTED)Notices.Add(kind+":"+code+":"+text);}
 public Assembly ResolveRef(object lib){throw new InvalidOperationException("Untested SDK assembly reference");}
 public Assembly Import(ITypeLib lib,string ns){
  string name,doc,helpFile;int help;lib.GetDocumentation(-1,out name,out doc,out help,out helpFile);
  name=System.Text.RegularExpressions.Regex.Replace(name,"[^A-Za-z0-9_]","_");
  Assembly found;if(imports.TryGetValue(name,out found))return found;
  var file=Path.Combine(directory,name+".dll");
  if(File.Exists(file))throw new InvalidOperationException("Refusing existing generated assembly "+file);
  var assembly=new TypeLibConverter().ConvertTypeLibToAssembly(lib,file,TypeLibImporterFlags.ImportAsX86,this,null,null,ns,null);
  assembly.Save(Path.GetFileName(file));imports.Add(name,assembly);return assembly;
 }
 public static string[] Generate(string tlb,string directory){
  ITypeLib lib;Marshal.ThrowExceptionForHR(LoadTypeLibEx(tlb,2,out lib));
  var importer=new MwSdkInteropImporter(directory);var assembly=importer.Import(lib,"MwAdeGenerated");
  var results=new List<string>();
  foreach(var type in assembly.GetTypes())if(type.Name=="_Variables"||type.Name=="_Variable"){
   results.Add(type.FullName+" GUID="+type.GUID);
   foreach(var method in type.GetMethods())results.Add(method.ToString());
  }
  results.AddRange(importer.Notices);return results.ToArray();
 }
}
