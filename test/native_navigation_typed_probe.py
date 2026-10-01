"""Explicit SAFEARRAY pointer marshalling; no source writes or controller actions."""
import os, json, pythoncom, win32com.client
workspace = os.environ['MOTIONWORKS_MCP_WORKSPACE']
assert os.path.basename(workspace).startswith('motionworks-ide-smoke-')
app = win32com.client.Dispatch('Ade.Application.550')
project = app.ActiveProject
assert os.path.normcase(project.FullName) == os.path.normcase(os.path.join(workspace, '.motionworks', 'stage', 'TopCutterS5.mwt'))
assert not project.IsModified
pou = project.Pous.Item('TopCutterCutControl')
for document in ['@POUS.' + pou.Name + '.' + pou.Name + 'V']:
    try:
        data = win32com.client.VARIANT(pythoncom.VT_BYREF | pythoncom.VT_ARRAY | pythoncom.VT_VARIANT, [])
        app.OpenDocument(document, True, data)
        print(json.dumps({'document':document,'view':project.GetLogicalNameOfActiveView(),'modified':bool(project.IsModified)}))
        break
    except pythoncom.com_error as error:
        print(json.dumps({'document':document,'error':str(error),'modified':bool(project.IsModified)}))
