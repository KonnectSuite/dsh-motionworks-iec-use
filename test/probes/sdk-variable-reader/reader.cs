using System;
using System.Collections.Generic;
using MwAdeGenerated;
public static class MwGeneratedVariableReader {
 static object Optional(string value){return String.IsNullOrEmpty(value)?null:value;}
 public static Dictionary<string,object>[] Read(object source){
  var vars=(_Variables)source;int count=vars.Count;
  var result=new List<Dictionary<string,object>>();
  var sections=new Dictionary<int,string>{{1,"VAR"},{2,"VAR_INPUT"},{3,"VAR_OUTPUT"},{4,"VAR_IN_OUT"},{5,"VAR_EXTERNAL"},{6,"VAR_GLOBAL"}};
  for(int n=1;n<=count;n++){
   var v=(_Variable)vars.Item(n);string section;
   if(!sections.TryGetValue((int)v.BlockType,out section))throw new InvalidOperationException("Unsupported native declaration usage");
   result.Add(new Dictionary<string,object>{
    {"name",v.Name},{"type",v.DataType},{"section",section},{"group",v.Group.Name},
    {"address",Optional(v.IecAddress)},{"initial_value",Optional(v.InitialValue)},{"description",Optional(v.Comment)},
    {"retain",v.Retain},{"pdd",v.PDD},{"opc",v.OPC},{"disabled",v.Disabled},{"not_on_plc",v.NotOnPlc},{"redundant",v.Redundant}
   });
  }
  if(vars.Count!=count)throw new InvalidOperationException("Native declaration count changed during inspection");
  return result.ToArray();
 }
}
