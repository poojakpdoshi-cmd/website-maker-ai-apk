@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package ai.nexora.nativeapp

import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.util.Base64
import ai.nexora.nativeapp.data.AdminAccount
import ai.nexora.nativeapp.data.AdminSummary
import ai.nexora.nativeapp.data.LoginResult
import ai.nexora.nativeapp.data.NativeImageAttachment
import ai.nexora.nativeapp.data.NativeProject
import ai.nexora.nativeapp.data.NativeProjectDetail
import ai.nexora.nativeapp.data.NexoraApi
import ai.nexora.nativeapp.data.SessionStore
import ai.nexora.nativeapp.ui.theme.NexoraTheme
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.DisableSelection
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

data class ChatMessage(
    val role: String,
    val text: String
)

private data class SelectedAttachment(
    val name: String,
    val mimeType: String,
    val imageBase64: String? = null,
    val textContent: String? = null
) {
    fun asGenerationImage(): NativeImageAttachment? =
        imageBase64?.let {
            NativeImageAttachment(
                name = name,
                mimeType = mimeType,
                data = it
            )
        }
}

private fun readSelectedAttachment(
    context: Context,
    uri: Uri
): SelectedAttachment {
    val resolver = context.contentResolver

    val displayName = resolver.query(
        uri,
        arrayOf(OpenableColumns.DISPLAY_NAME),
        null,
        null,
        null
    )?.use { cursor ->
        val index = cursor.getColumnIndex(
            OpenableColumns.DISPLAY_NAME
        )
        if (index >= 0 && cursor.moveToFirst()) {
            cursor.getString(index)
        } else {
            null
        }
    } ?: "attachment"

    val mimeType =
        resolver.getType(uri)
            ?: "application/octet-stream"

    val bytes = resolver.openInputStream(uri)?.use {
        it.readBytes()
    } ?: error("Could not read the selected attachment.")

    require(bytes.size <= 6 * 1024 * 1024) {
        "Attachment must be smaller than 6 MB."
    }

    val extension =
        displayName.substringAfterLast(
            '.',
            ""
        ).lowercase()

    val textExtensions = setOf(
        "txt",
        "md",
        "json",
        "xml",
        "html",
        "css",
        "js",
        "jsx",
        "ts",
        "tsx",
        "kt",
        "java",
        "py",
        "sql",
        "csv",
        "yaml",
        "yml",
        "sh"
    )

    return when {
        mimeType.startsWith("image/") -> {
            SelectedAttachment(
                name = displayName,
                mimeType = mimeType,
                imageBase64 = Base64.encodeToString(
                    bytes,
                    Base64.NO_WRAP
                )
            )
        }

        mimeType.startsWith("text/") ||
            mimeType == "application/json" ||
            mimeType == "application/xml" ||
            extension in textExtensions -> {
            SelectedAttachment(
                name = displayName,
                mimeType = mimeType,
                textContent = bytes
                    .toString(Charsets.UTF_8)
                    .take(16000)
            )
        }

        else -> {
            error(
                "This build supports photos and " +
                    "text/code files. PDF and DOCX support " +
                    "needs a backend upload endpoint."
            )
        }
    }
}

private enum class NativeScreen {
    CHAT,
    STUDIO,
    PROJECTS,
    ACCOUNT
}

private enum class AppMode {
    LOGIN,
    USER,
    ADMIN
}

class MainActivity : ComponentActivity() {
    private lateinit var sessionStore: SessionStore
    private lateinit var installationId: String

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        sessionStore = SessionStore(this)
        installationId = sessionStore.installationId()

        setContent {
            NexoraTheme {
                var mode by remember {
                    mutableStateOf(
                        if (sessionStore.token() != null) {
                            AppMode.USER
                        } else {
                            AppMode.LOGIN
                        }
                    )
                }
                var adminToken by remember {
                    mutableStateOf("")
                }

                NexoraBackground {
                    when (mode) {
                        AppMode.USER -> {
                            NativeHome(
                                sessionStore = sessionStore,
                                installationId = installationId,
                                onLogout = {
                                    sessionStore.clear()
                                    mode = AppMode.LOGIN
                                }
                            )
                        }

                        AppMode.ADMIN -> {
                            Scaffold(
                                containerColor = Color.Transparent,
                                topBar = {
                                    TopAppBar(
                                        title = {
                                            Text(
                                                "Owner Control Centre",
                                                fontWeight = FontWeight.Black
                                            )
                                        },
                                        navigationIcon = {
                                            IconButton(
                                                onClick = {
                                                    adminToken = ""
                                                    mode = AppMode.LOGIN
                                                }
                                            ) {
                                                Icon(
                                                    Icons.Default.ArrowBack,
                                                    contentDescription =
                                                        "Exit admin"
                                                )
                                            }
                                        },
                                        colors =
                                            TopAppBarDefaults
                                                .topAppBarColors(
                                                    containerColor =
                                                        MaterialTheme
                                                            .colorScheme
                                                            .surface
                                                            .copy(
                                                                alpha = 0.82f
                                                            )
                                                )
                                    )
                                }
                            ) { padding ->
                                Box(
                                    modifier = Modifier
                                        .padding(padding)
                                        .fillMaxSize()
                                ) {
                                    AdminScreen(
                                        initialToken = adminToken,
                                        onExit = {
                                            adminToken = ""
                                            mode = AppMode.LOGIN
                                        }
                                    )
                                }
                            }
                        }

                        AppMode.LOGIN -> {
                            NativeLoginScreen(
                                installationId = installationId,
                                onUserSuccess = {
                                    sessionStore.save(
                                        it.token,
                                        it.username,
                                        it.internalEmail
                                    )
                                    mode = AppMode.USER
                                },
                                onAdminSuccess = {
                                    adminToken = it.token
                                    mode = AppMode.ADMIN
                                }
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun NexoraBackground(content: @Composable () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(
                        Color(0xFF02030A),
                        Color(0xFF071127),
                        Color(0xFF120824),
                        Color(0xFF03050D)
                    )
                )
            )
    ) {
        content()
    }
}

@Composable
private fun GlassPanel(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(26.dp),
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.86f),
        border = BorderStroke(
            1.dp,
            MaterialTheme.colorScheme.primary.copy(alpha = 0.28f)
        ),
        shadowElevation = 14.dp,
        content = content
    )
}

@Composable
private fun NativeLoginScreen(
    installationId: String,
    onUserSuccess: (LoginResult) -> Unit,
    onAdminSuccess: (ai.nexora.nativeapp.data.AdminLoginResult) -> Unit
) {
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var errorText by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()

    Box(
        modifier = Modifier
            .fillMaxSize()
            .imePadding()
            .padding(22.dp)
    ) {
        GlassPanel(
            modifier = Modifier
                .align(Alignment.Center)
                .fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(22.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                Image(
                    painter = painterResource(R.drawable.nexora_logo),
                    contentDescription = "Nexora logo",
                    modifier = Modifier.size(92.dp),
                    contentScale = ContentScale.Fit
                )

                Text(
                    "Nexora.Ai",
                    style = MaterialTheme.typography.displaySmall,
                    fontWeight = FontWeight.Black
                )

                Text(
                    "Build real websites with AI",
                    color = MaterialTheme.colorScheme.secondary
                )

                OutlinedTextField(
                    value = username,
                    onValueChange = { username = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Username") },
                    singleLine = true
                )

                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Password") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation()
                )

                AnimatedVisibility(errorText.isNotBlank()) {
                    Text(
                        errorText,
                        color = MaterialTheme.colorScheme.error
                    )
                }

                Button(
                    enabled = !loading &&
                        username.isNotBlank() &&
                        password.isNotBlank(),
                    onClick = {
                        loading = true
                        errorText = ""
                        scope.launch {
                            val cleanUsername = username.trim()

                            if (cleanUsername == "Poojak@King") {
                                runCatching {
                                    NexoraApi.adminLogin(
                                        cleanUsername,
                                        password
                                    )
                                }.onSuccess(onAdminSuccess)
                                    .onFailure {
                                        errorText =
                                            it.message
                                                ?: "Admin login failed."
                                    }
                            } else {
                                runCatching {
                                    NexoraApi.login(
                                        cleanUsername,
                                        password,
                                        installationId
                                    )
                                }.onSuccess(onUserSuccess)
                                    .onFailure {
                                        errorText =
                                            it.message
                                                ?: "Login failed."
                                    }
                            }

                            loading = false
                        }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(54.dp)
                ) {
                    Text(
                        if (loading) "Signing in…" else "Sign in"
                    )
                }

                DisableSelection {
                    Text(
                        "Made by Poojak Doshi",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}

@Composable
private fun NativeHome(
    sessionStore: SessionStore,
    installationId: String,
    onLogout: () -> Unit
) {
    var screen by rememberSaveable {
        mutableStateOf(NativeScreen.CHAT)
    }
    val drawerState = rememberDrawerState(
        initialValue = DrawerValue.Closed
    )
    val scope = rememberCoroutineScope()

    fun openScreen(destination: NativeScreen) {
        screen = destination
        scope.launch { drawerState.close() }
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        gesturesEnabled = true,
        drawerContent = {
            ModalDrawerSheet(
                modifier = Modifier.widthIn(max = 310.dp),
                drawerContainerColor =
                    MaterialTheme.colorScheme.surface.copy(alpha = 0.98f)
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(horizontal = 14.dp, vertical = 18.dp)
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Image(
                            painter = painterResource(R.drawable.nexora_logo),
                            contentDescription = "Nexora logo",
                            modifier = Modifier.size(64.dp),
                            contentScale = ContentScale.Fit
                        )

                        Column {
                            Text(
                                "Nexora.Ai",
                                style =
                                    MaterialTheme.typography.titleLarge,
                                fontWeight = FontWeight.Black
                            )
                            Text(
                                sessionStore.username().orEmpty(),
                                style =
                                    MaterialTheme.typography.bodySmall,
                                color =
                                    MaterialTheme.colorScheme.secondary
                            )
                        }
                    }

                    Spacer(Modifier.height(14.dp))

                    NavigationDrawerItem(
                        selected = screen == NativeScreen.CHAT,
                        onClick = {
                            openScreen(NativeScreen.CHAT)
                        },
                        icon = {
                            Icon(
                                Icons.Default.Chat,
                                contentDescription = null
                            )
                        },
                        label = { Text("Chat") },
                        shape = RoundedCornerShape(18.dp)
                    )

                    NavigationDrawerItem(
                        selected = screen == NativeScreen.STUDIO,
                        onClick = {
                            openScreen(NativeScreen.STUDIO)
                        },
                        icon = {
                            Icon(
                                Icons.Default.Add,
                                contentDescription = null
                            )
                        },
                        label = { Text("Create") },
                        shape = RoundedCornerShape(18.dp)
                    )

                    NavigationDrawerItem(
                        selected = screen == NativeScreen.PROJECTS,
                        onClick = {
                            openScreen(NativeScreen.PROJECTS)
                        },
                        icon = {
                            Icon(
                                Icons.Default.Folder,
                                contentDescription = null
                            )
                        },
                        label = { Text("Projects") },
                        shape = RoundedCornerShape(18.dp)
                    )

                    NavigationDrawerItem(
                        selected = screen == NativeScreen.ACCOUNT,
                        onClick = {
                            openScreen(NativeScreen.ACCOUNT)
                        },
                        icon = {
                            Icon(
                                Icons.Default.AccountCircle,
                                contentDescription = null
                            )
                        },
                        label = { Text("Account") },
                        shape = RoundedCornerShape(18.dp)
                    )

                    Spacer(Modifier.weight(1f))

                    DisableSelection {
                        Text(
                            "Made by Poojak Doshi",
                            modifier = Modifier.padding(14.dp),
                            style = MaterialTheme.typography.bodySmall,
                            color =
                                MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }
    ) {
        Scaffold(
            containerColor = Color.Transparent,
            topBar = {
                TopAppBar(
                    title = {
                        Column {
                            Text(
                                screenTitle(screen),
                                fontWeight = FontWeight.Black
                            )
                            Text(
                                "Nexora.Ai",
                                style =
                                    MaterialTheme.typography.labelSmall,
                                color =
                                    MaterialTheme.colorScheme.secondary
                            )
                        }
                    },
                    navigationIcon = {
                        IconButton(
                            onClick = {
                                scope.launch {
                                    drawerState.open()
                                }
                            }
                        ) {
                            Icon(
                                Icons.Default.Menu,
                                contentDescription = "Open sidebar"
                            )
                        }
                    },
                    colors =
                        TopAppBarDefaults.topAppBarColors(
                            containerColor =
                                MaterialTheme.colorScheme.surface
                                    .copy(alpha = 0.82f)
                        )
                )
            }
        ) { padding ->
            Box(
                modifier = Modifier
                    .padding(padding)
                    .fillMaxSize()
            ) {
                when (screen) {
                    NativeScreen.CHAT -> ChatScreen(
                        sessionStore,
                        installationId
                    )

                    NativeScreen.STUDIO -> StudioScreen(
                        sessionStore,
                        installationId
                    )

                    NativeScreen.PROJECTS -> ProjectsScreen(
                        sessionStore,
                        installationId
                    )

                    NativeScreen.ACCOUNT -> AccountScreen(
                        sessionStore,
                        installationId,
                        onLogout
                    )
                }
            }
        }
    }
}

private fun screenTitle(screen: NativeScreen): String =
    when (screen) {
        NativeScreen.CHAT -> "Chat"
        NativeScreen.STUDIO -> "Create Studio"
        NativeScreen.PROJECTS -> "My Projects"
        NativeScreen.ACCOUNT -> "Account"
    }

private fun isWebsiteGenerationRequest(message: String): Boolean {
    val value = message.lowercase().trim()

    val creationWords = listOf(
        "make",
        "create",
        "build",
        "generate",
        "design",
        "develop"
    )

    val websiteWords = listOf(
        "website",
        "web site",
        "landing page",
        "saas",
        "portfolio",
        "ecommerce",
        "e-commerce",
        "online store",
        "business site"
    )

    return creationWords.any(value::contains) &&
        websiteWords.any(value::contains)
}

private suspend fun generateWebsiteFromChat(
    sessionStore: SessionStore,
    installationId: String,
    prompt: String,
    image: NativeImageAttachment? = null,
    onProgress: (String) -> Unit
): NativeProjectDetail {
    val token =
        sessionStore.token() ?: error("Session missing")
    val email =
        sessionStore.email() ?: error("Email missing")

    onProgress("Starting the website generation engine…")

    val started = NexoraApi.startGeneration(
        token = token,
        installationId = installationId,
        email = email,
        prompt = prompt,
        generationMode = "standard",
        thinkMax = true,
        image = image
    )

    onProgress(
        "Website job started: ${started.progress}%"
    )

    repeat(240) {
        delay(1500)

        val job = NexoraApi.getGenerationStatus(
            token = token,
            installationId = installationId,
            email = email,
            jobId = started.jobId
        )

        val step = job.currentStep
            ?: job.currentAgent
            ?: job.status

        onProgress(
            "Building your website — " +
                "${job.progress.coerceIn(0, 100)}%\n$step"
        )

        when (job.status.lowercase()) {
            "completed",
            "complete",
            "success",
            "succeeded" -> {
                val projectId = job.projectId
                    ?: error(
                        "Generation completed, but the project ID " +
                            "was missing."
                    )

                return NexoraApi.getProject(
                    token,
                    installationId,
                    email,
                    projectId
                )
            }

            "failed",
            "error",
            "cancelled",
            "canceled" -> {
                error(
                    job.errorMessage
                        ?: "Website generation failed."
                )
            }
        }
    }

    error(
        "Website generation timed out. " +
            "The job remains saved and can be checked in Projects."
    )
}

@Composable
private fun ChatScreen(
    sessionStore: SessionStore,
    installationId: String
) {
    val context = LocalContext.current
    var input by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var attachment by remember {
        mutableStateOf<SelectedAttachment?>(null)
    }
    var attachmentError by remember {
        mutableStateOf("")
    }

    val attachmentLauncher =
        rememberLauncherForActivityResult(
            ActivityResultContracts.OpenDocument()
        ) { uri ->
            if (uri != null) {
                runCatching {
                    readSelectedAttachment(context, uri)
                }.onSuccess {
                    attachment = it
                    attachmentError = ""
                }.onFailure {
                    attachment = null
                    attachmentError =
                        it.message ?: "Attachment failed."
                }
            }
        }

    val messages = remember {
        mutableStateListOf(
            ChatMessage(
                "assistant",
                "Tell me what you need. I can answer questions, " +
                    "read text/code files, or build a real website " +
                    "using an attached photo as a visual reference."
            )
        )
    }

    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) {
            listState.animateScrollToItem(
                messages.lastIndex
            )
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .imePadding()
    ) {
        LazyColumn(
            state = listState,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            contentPadding = PaddingValues(
                start = 14.dp,
                end = 14.dp,
                top = 14.dp,
                bottom = 20.dp
            ),
            verticalArrangement =
                Arrangement.spacedBy(12.dp)
        ) {
            items(messages) { message ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement =
                        if (message.role == "user") {
                            Arrangement.End
                        } else {
                            Arrangement.Start
                        }
                ) {
                    Surface(
                        modifier =
                            Modifier.widthIn(max = 330.dp),
                        shape = RoundedCornerShape(
                            topStart = 22.dp,
                            topEnd = 22.dp,
                            bottomStart =
                                if (message.role == "user") {
                                    22.dp
                                } else {
                                    7.dp
                                },
                            bottomEnd =
                                if (message.role == "user") {
                                    7.dp
                                } else {
                                    22.dp
                                }
                        ),
                        color =
                            if (message.role == "user") {
                                MaterialTheme.colorScheme
                                    .primaryContainer
                                    .copy(alpha = 0.94f)
                            } else {
                                MaterialTheme.colorScheme
                                    .surfaceVariant
                                    .copy(alpha = 0.82f)
                            },
                        border = BorderStroke(
                            1.dp,
                            if (message.role == "user") {
                                MaterialTheme.colorScheme
                                    .primary
                                    .copy(alpha = 0.34f)
                            } else {
                                MaterialTheme.colorScheme
                                    .secondary
                                    .copy(alpha = 0.22f)
                            }
                        )
                    ) {
                        DisableSelection {
                            Text(
                                message.text,
                                modifier = Modifier.padding(15.dp),
                                style =
                                    MaterialTheme.typography
                                        .bodyLarge
                            )
                        }
                    }
                }
            }
        }

        GlassPanel(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(
                    horizontal = 12.dp,
                    vertical = 10.dp
                )
        ) {
            Column(
                modifier = Modifier.padding(
                    horizontal = 8.dp,
                    vertical = 6.dp
                ),
                verticalArrangement =
                    Arrangement.spacedBy(6.dp)
            ) {
                attachment?.let { selected ->
                    Surface(
                        shape = RoundedCornerShape(16.dp),
                        color = MaterialTheme.colorScheme
                            .secondaryContainer
                            .copy(alpha = 0.78f)
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(
                                    start = 10.dp,
                                    top = 4.dp,
                                    bottom = 4.dp
                                ),
                            verticalAlignment =
                                Alignment.CenterVertically
                        ) {
                            Icon(
                                Icons.Default.AttachFile,
                                contentDescription = null
                            )
                            Text(
                                selected.name,
                                modifier = Modifier
                                    .padding(horizontal = 8.dp)
                                    .weight(1f),
                                maxLines = 1
                            )
                            IconButton(
                                onClick = {
                                    attachment = null
                                }
                            ) {
                                Icon(
                                    Icons.Default.Close,
                                    contentDescription =
                                        "Remove attachment"
                                )
                            }
                        }
                    }
                }

                if (attachmentError.isNotBlank()) {
                    Text(
                        attachmentError,
                        color =
                            MaterialTheme.colorScheme.error,
                        style =
                            MaterialTheme.typography.bodySmall
                    )
                }

                Row(
                    verticalAlignment = Alignment.Bottom,
                    horizontalArrangement =
                        Arrangement.spacedBy(6.dp)
                ) {
                    IconButton(
                        enabled = !loading,
                        onClick = {
                            attachmentLauncher.launch(
                                arrayOf("*/*")
                            )
                        }
                    ) {
                        Icon(
                            Icons.Default.AttachFile,
                            contentDescription =
                                "Attach photo or file"
                        )
                    }

                    TextField(
                        value = input,
                        onValueChange = { input = it },
                        modifier = Modifier.weight(1f),
                        placeholder = {
                            Text("Message Nexora…")
                        },
                        maxLines = 5,
                        shape = RoundedCornerShape(22.dp)
                    )

                    Button(
                        enabled =
                            input.isNotBlank() && !loading,
                        onClick = {
                            val request = input.trim()
                            val selectedAttachment =
                                attachment

                            input = ""
                            attachment = null
                            attachmentError = ""

                            val visibleMessage =
                                if (
                                    selectedAttachment != null
                                ) {
                                    request +
                                        "\n\nAttached: " +
                                        selectedAttachment.name
                                } else {
                                    request
                                }

                            val promptWithFile =
                                selectedAttachment
                                    ?.textContent
                                    ?.let { fileText ->
                                        request +
                                            "\n\nAttached file: " +
                                            selectedAttachment.name +
                                            "\n---\n" +
                                            fileText
                                    }
                                    ?: request

                            messages += ChatMessage(
                                "user",
                                visibleMessage
                            )
                            loading = true

                            if (
                                isWebsiteGenerationRequest(
                                    request
                                )
                            ) {
                                messages += ChatMessage(
                                    "assistant",
                                    "Preparing your website…"
                                )
                                val statusIndex =
                                    messages.lastIndex

                                scope.launch {
                                    runCatching {
                                        generateWebsiteFromChat(
                                            sessionStore,
                                            installationId,
                                            promptWithFile,
                                            selectedAttachment
                                                ?.asGenerationImage()
                                        ) { status ->
                                            messages[
                                                statusIndex
                                            ] = ChatMessage(
                                                "assistant",
                                                status
                                            )
                                        }
                                    }.onSuccess { project ->
                                        messages[
                                            statusIndex
                                        ] = ChatMessage(
                                            "assistant",
                                            "Website generated " +
                                                "successfully.\n\n" +
                                                "Project: " +
                                                project.project.name +
                                                "\nVersion: " +
                                                project.versionNumber +
                                                "\n\nSaved in " +
                                                "My Projects."
                                        )
                                    }.onFailure {
                                        messages[
                                            statusIndex
                                        ] = ChatMessage(
                                            "assistant",
                                            "Website generation " +
                                                "failed:\n" +
                                                (
                                                    it.message
                                                        ?: "Unknown error"
                                                    )
                                        )
                                    }
                                    loading = false
                                }
                            } else if (
                                selectedAttachment
                                    ?.imageBase64 != null
                            ) {
                                messages += ChatMessage(
                                    "assistant",
                                    "The photo is attached. " +
                                        "Photo references are currently " +
                                        "sent to the website generator. " +
                                        "Ask me to build or redesign a " +
                                        "website using this photo."
                                )
                                loading = false
                            } else {
                                scope.launch {
                                    val response =
                                        runCatching {
                                            NexoraApi.sendChat(
                                                sessionStore.token()
                                                    ?: error(
                                                        "Session missing"
                                                    ),
                                                installationId,
                                                sessionStore
                                                    .username()
                                                    ?: "Poojak",
                                                sessionStore.email()
                                                    ?: error(
                                                        "Email missing"
                                                    ),
                                                promptWithFile
                                            )
                                        }.getOrElse {
                                            "Error: " +
                                                (
                                                    it.message
                                                        ?: "Chat request " +
                                                            "failed"
                                                    )
                                        }

                                    messages += ChatMessage(
                                        "assistant",
                                        response
                                    )
                                    loading = false
                                }
                            }
                        },
                        modifier = Modifier.size(50.dp),
                        shape = CircleShape,
                        contentPadding = PaddingValues(0.dp)
                    ) {
                        if (loading) {
                            CircularProgressIndicator(
                                modifier =
                                    Modifier.size(22.dp),
                                strokeWidth = 2.dp,
                                color = MaterialTheme
                                    .colorScheme
                                    .onPrimary
                            )
                        } else {
                            Icon(
                                Icons.Default.Send,
                                contentDescription = "Send"
                            )
                        }
                    }
                }
            }
        }
    }
}


@Composable
fun GenerationScreen(
    sessionStore: SessionStore,
    installationId: String
) {
    var prompt by remember { mutableStateOf("") }
    var thinkMax by remember { mutableStateOf(true) }
    var running by remember { mutableStateOf(false) }
    var progress by remember { mutableStateOf(0) }
    var status by remember { mutableStateOf("Ready") }
    var errorText by remember { mutableStateOf("") }
    var result by remember {
        mutableStateOf<NativeProjectDetail?>(null)
    }
    val scope = rememberCoroutineScope()

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .imePadding(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            Text(
                "Create a website",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Black
            )
        }

        item {
            Text(
                "Describe the business, pages, design, features " +
                    "and content you need.",
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        item {
            GlassPanel(Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement =
                        Arrangement.spacedBy(12.dp)
                ) {
                    OutlinedTextField(
                        value = prompt,
                        onValueChange = { prompt = it },
                        modifier = Modifier.fillMaxWidth(),
                        label = {
                            Text("Describe your website")
                        },
                        minLines = 5,
                        maxLines = 10
                    )

                    Row(
                        verticalAlignment =
                            Alignment.CenterVertically,
                        horizontalArrangement =
                            Arrangement.spacedBy(8.dp)
                    ) {
                        FilterChip(
                            selected = thinkMax,
                            onClick = {
                                thinkMax = !thinkMax
                            },
                            label = {
                                Text(
                                    if (thinkMax) {
                                        "ThinkMax enabled"
                                    } else {
                                        "ThinkMax disabled"
                                    }
                                )
                            }
                        )
                    }

                    Button(
                        enabled =
                            prompt.isNotBlank() && !running,
                        onClick = {
                            val request = prompt.trim()
                            running = true
                            progress = 0
                            status = "Starting"
                            errorText = ""
                            result = null

                            scope.launch {
                                runCatching {
                                    val token =
                                        sessionStore.token()
                                            ?: error(
                                                "Session missing"
                                            )
                                    val email =
                                        sessionStore.email()
                                            ?: error(
                                                "Email missing"
                                            )

                                    val started =
                                        NexoraApi.startGeneration(
                                            token,
                                            installationId,
                                            email,
                                            request,
                                            "standard",
                                            thinkMax
                                        )

                                    status = started.status
                                    progress = started.progress

                                    repeat(240) {
                                        delay(1500)

                                        val job =
                                            NexoraApi
                                                .getGenerationStatus(
                                                    token,
                                                    installationId,
                                                    email,
                                                    started.jobId
                                                )

                                        status =
                                            job.currentStep
                                                ?: job.currentAgent
                                                ?: job.status
                                        progress =
                                            job.progress.coerceIn(
                                                0,
                                                100
                                            )

                                        when (
                                            job.status.lowercase()
                                        ) {
                                            "completed",
                                            "complete",
                                            "success",
                                            "succeeded" -> {
                                                val projectId =
                                                    job.projectId
                                                        ?: error(
                                                            "Project ID " +
                                                                "missing"
                                                        )

                                                result =
                                                    NexoraApi.getProject(
                                                        token,
                                                        installationId,
                                                        email,
                                                        projectId
                                                    )
                                                return@runCatching
                                            }

                                            "failed",
                                            "error",
                                            "cancelled",
                                            "canceled" -> {
                                                error(
                                                    job.errorMessage
                                                        ?: "Generation " +
                                                            "failed"
                                                )
                                            }
                                        }
                                    }

                                    error(
                                        "Generation timed out. " +
                                            "Check My Projects."
                                    )
                                }.onFailure {
                                    errorText =
                                        it.message
                                            ?: "Generation failed."
                                }
                                running = false
                            }
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(52.dp)
                    ) {
                        Text(
                            if (running) {
                                "Generating…"
                            } else {
                                "Generate website"
                            }
                        )
                    }
                }
            }
        }

        if (running || progress > 0) {
            item {
                GlassPanel(Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement =
                            Arrangement.spacedBy(10.dp)
                    ) {
                        LinearProgressIndicator(
                            progress = {
                                progress.coerceIn(
                                    0,
                                    100
                                ) / 100f
                            },
                            modifier = Modifier.fillMaxWidth()
                        )
                        Text("$status — $progress%")
                    }
                }
            }
        }

        if (errorText.isNotBlank()) {
            item {
                Text(
                    errorText,
                    color = MaterialTheme.colorScheme.error
                )
            }
        }

        result?.let { project ->
            item {
                GlassPanel(Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement =
                            Arrangement.spacedBy(8.dp)
                    ) {
                        Text(
                            project.project.name,
                            style =
                                MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Black
                        )
                        Text(
                            "Version ${project.versionNumber}"
                        )
                        Text(
                            "Website generated and saved in " +
                                "My Projects.",
                            color =
                                MaterialTheme.colorScheme.primary
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ProjectsScreen(
    sessionStore: SessionStore,
    installationId: String
) {
    var projects by remember {
        mutableStateOf<List<NativeProject>>(emptyList())
    }
    var selected by remember {
        mutableStateOf<NativeProjectDetail?>(null)
    }
    var loading by remember { mutableStateOf(true) }
    var errorText by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()

    fun load() {
        loading = true
        errorText = ""
        scope.launch {
            runCatching {
                NexoraApi.listProjects(
                    sessionStore.token()
                        ?: error("Session missing"),
                    installationId,
                    sessionStore.email()
                        ?: error("Email missing")
                )
            }.onSuccess {
                projects = it
            }.onFailure {
                errorText =
                    it.message ?: "Could not load projects."
            }
            loading = false
        }
    }

    LaunchedEffect(Unit) { load() }

    selected?.let { detail ->
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                TextButton(
                    onClick = { selected = null }
                ) {
                    Text("← My Projects")
                }
            }
            item {
                Text(
                    detail.project.name,
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Black
                )
            }
            item {
                Text(
                    "${detail.project.websiteType} · " +
                        detail.project.framework,
                    color = MaterialTheme.colorScheme.secondary
                )
            }
            item {
                Text("Status: ${detail.project.status}")
            }
            item {
                Text("Version: ${detail.versionNumber}")
            }
            item {
                GlassPanel(Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement =
                            Arrangement.spacedBy(8.dp)
                    ) {
                        Text(
                            "Preview source",
                            fontWeight = FontWeight.Bold
                        )
                        DisableSelection {
                            Text(
                                if (
                                    detail.previewHtml.isBlank()
                                ) {
                                    "No preview available."
                                } else {
                                    detail.previewHtml.take(1800)
                                },
                                style =
                                    MaterialTheme.typography.bodySmall
                            )
                        }
                    }
                }
            }
        }
        return
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 14.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                "Your generated websites",
                style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.weight(1f),
                fontWeight = FontWeight.Black
            )
            IconButton(onClick = { load() }) {
                Icon(
                    Icons.Default.Refresh,
                    contentDescription = "Refresh"
                )
            }
        }

        if (loading) {
            LinearProgressIndicator(
                Modifier.fillMaxWidth()
            )
        }

        if (errorText.isNotBlank()) {
            Text(
                errorText,
                color = MaterialTheme.colorScheme.error
            )
        }

        LazyColumn(
            verticalArrangement = Arrangement.spacedBy(10.dp),
            contentPadding = PaddingValues(vertical = 12.dp)
        ) {
            items(projects, key = { it.id }) { project ->
                GlassPanel(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable {
                            scope.launch {
                                loading = true
                                runCatching {
                                    NexoraApi.getProject(
                                        sessionStore.token()
                                            ?: error(
                                                "Session missing"
                                            ),
                                        installationId,
                                        sessionStore.email()
                                            ?: error(
                                                "Email missing"
                                            ),
                                        project.id
                                    )
                                }.onSuccess {
                                    selected = it
                                }.onFailure {
                                    errorText =
                                        it.message
                                            ?: "Could not open project."
                                }
                                loading = false
                            }
                        }
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement =
                            Arrangement.spacedBy(5.dp)
                    ) {
                        Text(
                            project.name,
                            fontWeight = FontWeight.Black
                        )
                        Text(
                            "${project.websiteType} · " +
                                project.framework,
                            color =
                                MaterialTheme.colorScheme.secondary
                        )
                        Text(project.status)
                    }
                }
            }
        }
    }
}

@Composable
private fun AdminScreen(
    initialToken: String = "",
    onExit: () -> Unit
) {
    var token by remember(initialToken) {
        mutableStateOf(initialToken)
    }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }

    var summary by remember {
        mutableStateOf(AdminSummary())
    }
    var accounts by remember {
        mutableStateOf<List<AdminAccount>>(emptyList())
    }

    var section by remember { mutableStateOf("overview") }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var errorText by remember { mutableStateOf("") }

    var newUser by remember { mutableStateOf("") }
    var newPassword by remember { mutableStateOf("") }

    var resetId by remember { mutableStateOf("") }
    var resetPassword by remember { mutableStateOf("") }
    var deleteId by remember { mutableStateOf("") }

    val scope = rememberCoroutineScope()

    suspend fun load(adminToken: String) {
        summary = NexoraApi.adminSummary(adminToken)
        accounts = NexoraApi.adminAccounts(adminToken)
    }

    LaunchedEffect(token) {
        if (token.isNotBlank()) {
            busy = true
            try {
                load(token)
            } catch (_: Throwable) {
                token = ""
            } finally {
                busy = false
            }
        }
    }

    if (token.isBlank()) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .imePadding()
                .padding(20.dp)
        ) {
            GlassPanel(
                modifier = Modifier
                    .align(Alignment.Center)
                    .fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(22.dp),
                    verticalArrangement =
                        Arrangement.spacedBy(14.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment =
                            Alignment.CenterVertically
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                "Owner Admin",
                                style =
                                    MaterialTheme.typography
                                        .headlineMedium,
                                fontWeight = FontWeight.Black
                            )
                            Text(
                                "Private control centre",
                                color =
                                    MaterialTheme.colorScheme.secondary
                            )
                        }

                        IconButton(onClick = onExit) {
                            Icon(
                                Icons.Default.Close,
                                contentDescription = "Exit admin"
                            )
                        }
                    }

                    OutlinedTextField(
                        value = username,
                        onValueChange = { username = it },
                        modifier = Modifier.fillMaxWidth(),
                        label = {
                            Text("Admin username")
                        },
                        singleLine = true
                    )

                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        modifier = Modifier.fillMaxWidth(),
                        label = {
                            Text("Admin password")
                        },
                        singleLine = true,
                        visualTransformation =
                            PasswordVisualTransformation()
                    )

                    if (errorText.isNotBlank()) {
                        Text(
                            errorText,
                            color =
                                MaterialTheme.colorScheme.error
                        )
                    }

                    Button(
                        enabled =
                            !busy &&
                                username.isNotBlank() &&
                                password.isNotBlank(),
                        onClick = {
                            busy = true
                            errorText = ""
                            scope.launch {
                                try {
                                    val result =
                                        NexoraApi.adminLogin(
                                            username.trim(),
                                            password
                                        )
                                    token = result.token
                                    password = ""
                                } catch (error: Throwable) {
                                    errorText =
                                        error.message
                                            ?: "Admin login failed."
                                } finally {
                                    busy = false
                                }
                            }
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(54.dp)
                    ) {
                        Text(
                            if (busy) {
                                "Checking…"
                            } else {
                                "Open Admin Panel"
                            }
                        )
                    }
                }
            }
        }
        return
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 14.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    "Admin Control Centre",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Black
                )
                Text(
                    "Live backend controls",
                    color = MaterialTheme.colorScheme.secondary
                )
            }

            IconButton(
                onClick = {
                    busy = true
                    scope.launch {
                        try {
                            load(token)
                        } catch (error: Throwable) {
                            errorText =
                                error.message ?: "Refresh failed."
                        } finally {
                            busy = false
                        }
                    }
                }
            ) {
                Icon(
                    Icons.Default.Refresh,
                    contentDescription = "Refresh"
                )
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            FilterChip(
                selected = section == "overview",
                onClick = { section = "overview" },
                label = { Text("Overview") }
            )

            FilterChip(
                selected = section == "users",
                onClick = { section = "users" },
                label = { Text("Users") }
            )

            OutlinedButton(
                onClick = {
                    scope.launch {
                        runCatching {
                            NexoraApi.adminLogout(token)
                        }
                        token = ""
                        onExit()
                    }
                }
            ) {
                Text("Exit")
            }
        }

        if (busy) {
            LinearProgressIndicator(
                Modifier.fillMaxWidth()
            )
        }

        if (message.isNotBlank()) {
            Text(
                message,
                color = MaterialTheme.colorScheme.primary
            )
        }

        if (errorText.isNotBlank()) {
            Text(
                errorText,
                color = MaterialTheme.colorScheme.error
            )
        }

        if (section == "overview") {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                item {
                    AdminMetric(
                        "Active subscribers",
                        summary.activeSubscribers
                    )
                }
                item {
                    AdminMetric(
                        "Pending payments",
                        summary.pendingPayments
                    )
                }
                item {
                    AdminMetric(
                        "Websites generated",
                        summary.websitesGenerated
                    )
                }
                item {
                    AdminMetric(
                        "Failed jobs",
                        summary.failedJobs
                    )
                }
                item {
                    AdminMetric(
                        "Active devices",
                        summary.activeDevices
                    )
                }
                item {
                    AdminMetric(
                        "Deployments",
                        summary.deployments
                    )
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                item {
                    GlassPanel(Modifier.fillMaxWidth()) {
                        Column(
                            modifier = Modifier.padding(16.dp),
                            verticalArrangement =
                                Arrangement.spacedBy(8.dp)
                        ) {
                            Text(
                                "Create Nexora user",
                                fontWeight = FontWeight.Bold
                            )

                            OutlinedTextField(
                                value = newUser,
                                onValueChange = {
                                    newUser = it
                                },
                                modifier =
                                    Modifier.fillMaxWidth(),
                                label = {
                                    Text("Username")
                                },
                                singleLine = true
                            )

                            OutlinedTextField(
                                value = newPassword,
                                onValueChange = {
                                    newPassword = it
                                },
                                modifier =
                                    Modifier.fillMaxWidth(),
                                label = {
                                    Text("Password")
                                },
                                singleLine = true,
                                visualTransformation =
                                    PasswordVisualTransformation()
                            )

                            Button(
                                enabled =
                                    !busy &&
                                        newUser.isNotBlank() &&
                                        newPassword.isNotBlank(),
                                onClick = {
                                    busy = true
                                    errorText = ""
                                    scope.launch {
                                        try {
                                            NexoraApi
                                                .adminCreateAccount(
                                                    token,
                                                    newUser.trim(),
                                                    newPassword
                                                )
                                            newUser = ""
                                            newPassword = ""
                                            message =
                                                "User created."
                                            load(token)
                                        } catch (
                                            error: Throwable
                                        ) {
                                            errorText =
                                                error.message
                                                    ?: "Create failed."
                                        } finally {
                                            busy = false
                                        }
                                    }
                                },
                                modifier =
                                    Modifier.fillMaxWidth()
                            ) {
                                Text("Create user")
                            }
                        }
                    }
                }

                items(accounts, key = { it.id }) { account ->
                    GlassPanel(Modifier.fillMaxWidth()) {
                        Column(
                            modifier = Modifier.padding(16.dp),
                            verticalArrangement =
                                Arrangement.spacedBy(6.dp)
                        ) {
                            Text(
                                account.username,
                                style =
                                    MaterialTheme.typography
                                        .titleLarge,
                                fontWeight = FontWeight.Black
                            )
                            Text(account.internalEmail)
                            Text(
                                "Status: ${account.status}",
                                color =
                                    MaterialTheme.colorScheme.secondary
                            )
                            Text(
                                "Plan: " +
                                    account.planName.ifBlank {
                                        account.planId.ifBlank {
                                            "Trial"
                                        }
                                    }
                            )
                            Text(
                                "Tokens: ${account.tokenBalance} · " +
                                    "Used: ${account.lifetimeUsed}"
                            )

                            if (resetId == account.id) {
                                OutlinedTextField(
                                    value = resetPassword,
                                    onValueChange = {
                                        resetPassword = it
                                    },
                                    modifier =
                                        Modifier.fillMaxWidth(),
                                    label = {
                                        Text("New password")
                                    },
                                    singleLine = true,
                                    visualTransformation =
                                        PasswordVisualTransformation()
                                )

                                Row(
                                    horizontalArrangement =
                                        Arrangement.spacedBy(8.dp)
                                ) {
                                    Button(
                                        onClick = {
                                            if (
                                                resetPassword.length <
                                                10 ||
                                                !resetPassword.any {
                                                    it.isLetter()
                                                } ||
                                                !resetPassword.any {
                                                    it.isDigit()
                                                }
                                            ) {
                                                errorText =
                                                    "Password needs " +
                                                        "10+ characters, " +
                                                        "a letter and " +
                                                        "a number."
                                            } else {
                                                busy = true
                                                scope.launch {
                                                    try {
                                                        NexoraApi
                                                            .adminChangePassword(
                                                                token,
                                                                account.id,
                                                                resetPassword
                                                            )
                                                        message =
                                                            "Password changed."
                                                        resetId = ""
                                                        resetPassword = ""
                                                    } catch (
                                                        error: Throwable
                                                    ) {
                                                        errorText =
                                                            error.message
                                                                ?: "Password " +
                                                                    "change failed."
                                                    } finally {
                                                        busy = false
                                                    }
                                                }
                                            }
                                        }
                                    ) {
                                        Text("Save")
                                    }

                                    TextButton(
                                        onClick = {
                                            resetId = ""
                                            resetPassword = ""
                                        }
                                    ) {
                                        Text("Cancel")
                                    }
                                }
                            } else {
                                OutlinedButton(
                                    onClick = {
                                        resetId = account.id
                                        resetPassword = ""
                                    }
                                ) {
                                    Text("Change password")
                                }
                            }

                            if (deleteId == account.id) {
                                Text(
                                    "Delete this user permanently?",
                                    color =
                                        MaterialTheme.colorScheme.error
                                )

                                Row(
                                    horizontalArrangement =
                                        Arrangement.spacedBy(8.dp)
                                ) {
                                    Button(
                                        onClick = {
                                            busy = true
                                            scope.launch {
                                                try {
                                                    NexoraApi
                                                        .adminDeleteAccount(
                                                            token,
                                                            account.id
                                                        )
                                                    message =
                                                        "User deleted."
                                                    deleteId = ""
                                                    load(token)
                                                } catch (
                                                    error: Throwable
                                                ) {
                                                    errorText =
                                                        error.message
                                                            ?: "Delete failed."
                                                } finally {
                                                    busy = false
                                                }
                                            }
                                        },
                                        colors =
                                            ButtonDefaults
                                                .buttonColors(
                                                    containerColor =
                                                        MaterialTheme
                                                            .colorScheme
                                                            .error
                                                )
                                    ) {
                                        Text("Confirm delete")
                                    }

                                    TextButton(
                                        onClick = {
                                            deleteId = ""
                                        }
                                    ) {
                                        Text("Cancel")
                                    }
                                }
                            } else {
                                TextButton(
                                    onClick = {
                                        deleteId = account.id
                                    }
                                ) {
                                    Text(
                                        "Delete user",
                                        color =
                                            MaterialTheme.colorScheme.error
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AdminMetric(
    label: String,
    value: Int
) {
    GlassPanel(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(18.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                label,
                modifier = Modifier.weight(1f)
            )
            Text(
                value.toString(),
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Black,
                color = MaterialTheme.colorScheme.primary
            )
        }
    }
}

@Composable
private fun AccountScreen(
    sessionStore: SessionStore,
    installationId: String,
    onLogout: () -> Unit
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            Text(
                "Account",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Black
            )
        }

        item {
            GlassPanel(Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement =
                        Arrangement.spacedBy(6.dp)
                ) {
                    Text(
                        "Username: " +
                            sessionStore.username().orEmpty()
                    )
                    Text(
                        "Email: " +
                            sessionStore.email().orEmpty()
                    )
                    Text(
                        "Device ID: " +
                            installationId.take(8) +
                            "…"
                    )
                }
            }
        }

        item {
            Button(
                onClick = onLogout,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("Logout")
            }
        }

        item {
            DisableSelection {
                Text(
                    "Nexora.Ai · Made by Poojak Doshi",
                    color =
                        MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}
