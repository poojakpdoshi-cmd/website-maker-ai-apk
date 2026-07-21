package ai.nexora.nativeapp.data

import ai.nexora.nativeapp.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

data class LoginResult(val token:String,val username:String,val internalEmail:String)
data class NativeProject(val id:String,val name:String,val websiteType:String,val status:String,val framework:String,val createdAt:String,val updatedAt:String)
data class NativeProjectDetail(val project:NativeProject,val previewHtml:String,val versionNumber:Int)

object NexoraApi {
 suspend fun login(username:String,password:String,installationId:String):LoginResult=withContext(Dispatchers.IO){
  val r=requestJson("/auth/login","POST",JSONObject().put("username",username).put("password",password).put("installationId",installationId))
  LoginResult(r.getString("token"),r.getString("username"),r.getString("internalEmail"))
 }
 suspend fun sendChat(token:String,installationId:String,username:String,email:String,message:String):String=withContext(Dispatchers.IO){
  requestJson("/assistant/chat","POST",JSONObject().put("message",message).put("username",username).put("email",email).put("installationId",installationId).put("history",JSONArray()),token,installationId).optString("reply","Nexora did not return a reply.")
 }
 suspend fun listProjects(token:String,installationId:String,email:String):List<NativeProject> = withContext(Dispatchers.IO){
  val a=requestJson("/projects?email="+URLEncoder.encode(email,Charsets.UTF_8.name()),"GET",token=token,installationId=installationId).optJSONArray("projects")?:JSONArray()
  buildList{for(i in 0 until a.length()) add(a.getJSONObject(i).toProject())}
 }
 suspend fun getProject(token:String,installationId:String,email:String,projectId:String):NativeProjectDetail = withContext(Dispatchers.IO){
  val r=requestJson("/projects/$projectId?email="+URLEncoder.encode(email,Charsets.UTF_8.name()),"GET",token=token,installationId=installationId)
  val v=r.optJSONObject("version"); NativeProjectDetail(r.getJSONObject("project").toProject(),v?.optString("preview_html").orEmpty(),v?.optInt("version_number",0)?:0)
 }
 private fun JSONObject.toProject()=NativeProject(optString("id"),optString("name","Untitled project"),optString("website_type","Website"),optString("status","Unknown"),optString("framework","Unknown"),optString("created_at"),optString("updated_at"))
 private fun requestJson(path:String,method:String,body:JSONObject?=null,token:String?=null,installationId:String?=null):JSONObject{
  val c=URL(BuildConfig.API_BASE+path).openConnection() as HttpURLConnection
  try{c.requestMethod=method;c.connectTimeout=20000;c.readTimeout=90000;c.setRequestProperty("Accept","application/json");token?.let{c.setRequestProperty("Authorization","Bearer $it")};installationId?.let{c.setRequestProperty("X-Device-Id",it)}
   if(body!=null){c.doOutput=true;c.setRequestProperty("Content-Type","application/json");c.outputStream.use{it.write(body.toString().toByteArray())}}
   val code=c.responseCode; val raw=(if(code in 200..299)c.inputStream else c.errorStream)?.bufferedReader()?.use{it.readText()}.orEmpty(); val j=runCatching{JSONObject(raw)}.getOrElse{JSONObject().put("error","Unreadable response ($code)")}; if(code !in 200..299) error(j.optString("error","Request failed ($code)")); return j
  } finally{c.disconnect()}
 }
}
