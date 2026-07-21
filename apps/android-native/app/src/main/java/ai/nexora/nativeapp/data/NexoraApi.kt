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
data class NativeGenerationStart(val jobId:String,val status:String,val progress:Int)
data class NativeGenerationStatus(val jobId:String,val status:String,val progress:Int,val projectId:String?=null,val currentAgent:String?=null,val currentStep:String?=null,val errorMessage:String?=null)
data class AdminLoginResult(val token:String,val username:String,val expiresAt:String)
data class AdminSummary(val activeSubscribers:Int=0,val pendingPayments:Int=0,val websitesGenerated:Int=0,val failedJobs:Int=0,val activeDevices:Int=0,val deployments:Int=0)
data class AdminAccount(val id:String,val username:String,val internalEmail:String,val status:String,val planId:String,val planName:String,val tokenBalance:Int,val lifetimeUsed:Int)
data class NativeIntegrationAccount(val accountName:String?=null)
data class NativeIntegrationStatus(val github:NativeIntegrationAccount?=null,val vercel:NativeIntegrationAccount?=null)
data class NativeEditResult(val projectId:String,val versionNumber:Int,val previewHtml:String)
data class NativePublishResult(val productionUrl:String,val state:String)

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
    suspend fun startGeneration(token:String,installationId:String,email:String,prompt:String,generationMode:String="standard",thinkMax:Boolean=false):NativeGenerationStart=withContext(Dispatchers.IO){
        val body=JSONObject().put("email",email).put("installationId",installationId).put("prompt",prompt).put("generationMode",generationMode).put("thinkMax",thinkMax)
        val r=requestJson("/generation-jobs/start","POST",body,token,installationId)
        val id=r.optString("_jobId").ifBlank{r.optString("jobId").ifBlank{r.optString("id")}}
        require(id.isNotBlank()){"Generation job ID missing"}
        NativeGenerationStart(id,r.optString("status","queued"),r.optInt("progress",0))
    }

    suspend fun getGenerationStatus(token:String,installationId:String,email:String,jobId:String):NativeGenerationStatus=withContext(Dispatchers.IO){
        val path="/generation-jobs/$jobId?email="+URLEncoder.encode(email,Charsets.UTF_8.name())
        val r=requestJson(path,"GET",token=token,installationId=installationId)
        val j=r.optJSONObject("job")?:r
        fun value(a:String,b:String)=j.optString(a).ifBlank{j.optString(b)}.takeIf{it.isNotBlank()}
        NativeGenerationStatus(jobId,j.optString("status","queued"),j.optInt("progress",0),value("projectId","project_id"),value("currentAgent","current_agent"),value("currentStep","current_step"),value("errorMessage","error_message"))
    }


 suspend fun adminLogin(username:String,password:String):AdminLoginResult=withContext(Dispatchers.IO){val r=requestJson("/admin/auth/login","POST",JSONObject().put("username",username).put("password",password));AdminLoginResult(r.getString("token"),r.optString("username",username),r.optString("expiresAt"))}
 suspend fun adminSummary(token:String):AdminSummary=withContext(Dispatchers.IO){val r=requestJson("/admin/summary","GET",token=token);AdminSummary(r.optInt("activeSubscribers"),r.optInt("pendingPayments"),r.optInt("websitesGenerated"),r.optInt("failedJobs"),r.optInt("activeDevices"),r.optInt("deployments"))}
 suspend fun adminAccounts(token:String):List<AdminAccount> = withContext(Dispatchers.IO){val x=requestJson("/admin/accounts","GET",token=token).optJSONArray("accounts")?:JSONArray();buildList{for(i in 0 until x.length()){val j=x.getJSONObject(i);add(AdminAccount(j.optString("id"),j.optString("username"),j.optString("internal_email"),j.optString("status","unknown"),j.optString("plan_id"),j.optString("plan_name"),j.optInt("token_balance"),j.optInt("lifetime_used")))}}}
 suspend fun adminCreateAccount(token:String,username:String,password:String)=withContext(Dispatchers.IO){requestJson("/admin/accounts/create","POST",JSONObject().put("username",username).put("password",password),token)}
 suspend fun adminChangePassword(token:String,id:String,password:String)=withContext(Dispatchers.IO){requestJson("/admin/accounts/${URLEncoder.encode(id,Charsets.UTF_8.name())}/password","PATCH",JSONObject().put("password",password),token)}
 suspend fun adminDeleteAccount(token:String,id:String)=withContext(Dispatchers.IO){requestJson("/admin/accounts/${URLEncoder.encode(id,Charsets.UTF_8.name())}","DELETE",token=token)}
 suspend fun adminLogout(token:String)=withContext(Dispatchers.IO){requestJson("/admin/auth/logout","POST",token=token)}


 suspend fun integrationStatus(token:String,installationId:String,email:String):NativeIntegrationStatus=withContext(Dispatchers.IO){
  val r=requestJson("/integrations/status?email="+URLEncoder.encode(email,Charsets.UTF_8.name()),"GET",token=token,installationId=installationId)
  fun account(name:String):NativeIntegrationAccount?=r.optJSONObject(name)?.let{NativeIntegrationAccount(it.optString("external_account_name").takeIf{v->v.isNotBlank()})}
  NativeIntegrationStatus(account("github"),account("vercel"))
 }
 suspend fun connectIntegration(token:String,installationId:String,email:String,provider:String,rawToken:String)=withContext(Dispatchers.IO){
  require(provider=="github"||provider=="vercel"){"Unsupported integration provider"}
  requestJson("/integrations/$provider/token","POST",JSONObject().put("email",email).put("installationId",installationId).put("token",rawToken),token,installationId)
 }
 suspend fun editProject(token:String,installationId:String,email:String,projectId:String,instruction:String):NativeEditResult=withContext(Dispatchers.IO){
  val r=requestJson("/projects/${URLEncoder.encode(projectId,Charsets.UTF_8.name())}/edit","POST",JSONObject().put("email",email).put("installationId",installationId).put("instruction",instruction),token,installationId)
  NativeEditResult(r.optString("projectId",projectId),r.optInt("versionNumber",0),r.optString("previewHtml"))
 }
 suspend fun publishProject(token:String,installationId:String,email:String,projectId:String):NativePublishResult=withContext(Dispatchers.IO){
  val r=requestJson("/projects/${URLEncoder.encode(projectId,Charsets.UTF_8.name())}/publish","POST",JSONObject().put("email",email).put("installationId",installationId),token,installationId)
  NativePublishResult(r.optString("productionUrl"),r.optString("state","unknown"))
 }

 private fun requestJson(path:String,method:String,body:JSONObject?=null,token:String?=null,installationId:String?=null):JSONObject{
  val c=URL(BuildConfig.API_BASE+path).openConnection() as HttpURLConnection
  try{c.requestMethod=method;c.connectTimeout=20000;c.readTimeout=90000;c.setRequestProperty("Accept","application/json");token?.let{c.setRequestProperty("Authorization","Bearer $it")};installationId?.let{c.setRequestProperty("X-Device-Id",it)}
   if(body!=null){c.doOutput=true;c.setRequestProperty("Content-Type","application/json");c.outputStream.use{it.write(body.toString().toByteArray())}}
   val code=c.responseCode; val raw=(if(code in 200..299)c.inputStream else c.errorStream)?.bufferedReader()?.use{it.readText()}.orEmpty(); val j=runCatching{JSONObject(raw)}.getOrElse{JSONObject().put("error","Unreadable response ($code)")}; if(code !in 200..299) error(j.optString("error","Request failed ($code)")); return j
  } finally{c.disconnect()}
 }
}
