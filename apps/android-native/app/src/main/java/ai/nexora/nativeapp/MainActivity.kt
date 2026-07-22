@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package ai.nexora.nativeapp

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.speech.RecognizerIntent
import android.text.format.DateUtils
import android.util.Base64
import ai.nexora.nativeapp.data.AdminAccount
import ai.nexora.nativeapp.data.AdminSummary
import ai.nexora.nativeapp.data.ChatThread
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
import androidx.compose.animation.Crossfade
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberDrawerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Locale

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

private val NexoraWelcomeMessage = ChatMessage(
    "assistant",
    "Nexora is ready. Choose Nexora Apex for deep work, " +
        "Nexora Core for balanced intelligence, or Nexora Swift " +
        "for speed. " +
        "Ask anything, attach a text/code file, or describe " +
        "the website you want to build."
)

private data class NexoraMode(
    val id: String,
    val name: String,
    val description: String
)

private val NexoraModes = listOf(
    NexoraMode(
        id = "x0-ultra",
        name = "Nexora Apex",
        description = "Deep reasoning, research, critique and repair"
    ),
    NexoraMode(
        id = "y1",
        name = "Nexora Core",
        description = "Balanced intelligence for everyday work"
    ),
    NexoraMode(
        id = "n1",
        name = "Nexora Swift",
        description = "Fast answers and lightweight tasks"
    )
)

private enum class VoiceCaptureMode {
    DICTATION,
    VOICE_ASK
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
                        Color(0xFF02040C),
                        Color(0xFF071329),
                        Color(0xFF130A2D),
                        Color(0xFF03050D)
                    )
                )
            )
    ) {
        Box(
            modifier = Modifier
                .align(Alignment.TopEnd)
                .size(310.dp)
                .background(
                    Brush.radialGradient(
                        listOf(
                            Color(0xFF63E9FF).copy(
                                alpha = 0.20f
                            ),
                            Color.Transparent
                        )
                    )
                ),
            content = {}
        )

        Box(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .size(330.dp)
                .background(
                    Brush.radialGradient(
                        listOf(
                            Color(0xFF9B7CFF).copy(
                                alpha = 0.15f
                            ),
                            Color.Transparent
                        )
                    )
                ),
            content = {}
        )

        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        listOf(
                            Color.Transparent,
                            Color(0x2203050D)
                        )
                    )
                )
        ) { content() }
    }
}

@Composable
internal fun GlassPanel(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit
) {
    Surface(
        modifier = modifier.animateContentSize(),
        shape = RoundedCornerShape(28.dp),
        color = Color.Transparent,
        contentColor = MaterialTheme.colorScheme.onSurface,
        shadowElevation = 18.dp,
        tonalElevation = 6.dp
    ) {
        Surface(
            modifier = Modifier.padding(1.dp),
            shape = RoundedCornerShape(27.dp),
            color = MaterialTheme.colorScheme.surface.copy(alpha = 0.94f),
            contentColor = MaterialTheme.colorScheme.onSurface,
            border = BorderStroke(
                1.dp,
                Brush.linearGradient(
                    listOf(
                        MaterialTheme.colorScheme.primary.copy(
                            alpha = 0.72f
                        ),
                        MaterialTheme.colorScheme.secondary.copy(
                            alpha = 0.46f
                        ),
                        MaterialTheme.colorScheme.tertiary.copy(
                            alpha = 0.30f
                        )
                    )
                )
            ),
            shadowElevation = 5.dp,
            tonalElevation = 6.dp,
            content = content
        )
    }
}

@Composable
internal fun nexoraTextFieldColors() = TextFieldDefaults.colors(
    focusedTextColor = MaterialTheme.colorScheme.onSurface,
    unfocusedTextColor = MaterialTheme.colorScheme.onSurface,
    disabledTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
    cursorColor = MaterialTheme.colorScheme.primary,
    focusedContainerColor = MaterialTheme.colorScheme.surfaceVariant
        .copy(alpha = 0.82f),
    unfocusedContainerColor = MaterialTheme.colorScheme.surfaceVariant
        .copy(alpha = 0.66f),
    focusedIndicatorColor = MaterialTheme.colorScheme.primary,
    unfocusedIndicatorColor = MaterialTheme.colorScheme.outlineVariant,
    focusedPlaceholderColor = MaterialTheme.colorScheme.onSurfaceVariant,
    unfocusedPlaceholderColor = MaterialTheme.colorScheme.onSurfaceVariant
)

@Composable
internal fun nexoraOutlinedFieldColors() =
    OutlinedTextFieldDefaults.colors(
        focusedTextColor = MaterialTheme.colorScheme.onSurface,
        unfocusedTextColor = MaterialTheme.colorScheme.onSurface,
        disabledTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
        cursorColor = MaterialTheme.colorScheme.primary,
        focusedBorderColor = MaterialTheme.colorScheme.primary,
        unfocusedBorderColor = MaterialTheme.colorScheme.outlineVariant,
        focusedLabelColor = MaterialTheme.colorScheme.primary,
        unfocusedLabelColor = MaterialTheme.colorScheme.onSurfaceVariant,
        focusedPlaceholderColor = MaterialTheme.colorScheme.onSurfaceVariant,
        unfocusedPlaceholderColor = MaterialTheme.colorScheme.onSurfaceVariant
    )

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

                Surface(
                    shape = RoundedCornerShape(999.dp),
                    color = MaterialTheme.colorScheme.primaryContainer
                        .copy(alpha = 0.74f),
                    border = BorderStroke(
                        1.dp,
                        MaterialTheme.colorScheme.primary.copy(
                            alpha = 0.42f
                        )
                    )
                ) {
                    Text(
                        "OMNIROUTE V1  •  NATIVE",
                        modifier = Modifier.padding(
                            horizontal = 12.dp,
                            vertical = 6.dp
                        ),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onPrimaryContainer
                    )
                }

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
                    singleLine = true,
                    colors = nexoraOutlinedFieldColors()
                )

                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Password") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    colors = nexoraOutlinedFieldColors()
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
    val initialThread = remember {
        sessionStore.ensureChatThread()
    }
    var chatThreads by remember {
        mutableStateOf(sessionStore.chatThreads())
    }
    var activeThreadId by rememberSaveable {
        mutableStateOf(initialThread.id)
    }
    var chatSearch by rememberSaveable {
        mutableStateOf("")
    }
    val chatMessages = remember {
        mutableStateListOf<ChatMessage>()
    }

    LaunchedEffect(activeThreadId) {
        sessionStore.selectChatThread(activeThreadId)
        val stored = sessionStore.chatThread(activeThreadId)

        chatMessages.clear()
        chatMessages.addAll(
            stored?.messages.orEmpty().map { (role, text) ->
                ChatMessage(role, text)
            }
        )

        if (chatMessages.isEmpty()) {
            chatMessages += NexoraWelcomeMessage
        }

        chatThreads = sessionStore.chatThreads()
    }

    fun persistActiveThread() {
        sessionStore.saveChatThread(
            activeThreadId,
            chatMessages.map { it.role to it.text }
        )
        chatThreads = sessionStore.chatThreads()
    }

    fun openScreen(destination: NativeScreen) {
        persistActiveThread()
        screen = destination
        scope.launch { drawerState.close() }
    }

    fun openThread(thread: ChatThread) {
        if (thread.id != activeThreadId) {
            persistActiveThread()
            activeThreadId = thread.id
        }
        screen = NativeScreen.CHAT
        scope.launch { drawerState.close() }
    }

    fun createThread() {
        persistActiveThread()
        val created = sessionStore.createChatThread()
        chatThreads = sessionStore.chatThreads()
        activeThreadId = created.id
        screen = NativeScreen.CHAT
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

                    Spacer(Modifier.height(10.dp))

                    Button(
                        onClick = ::createThread,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(54.dp),
                        shape = RoundedCornerShape(18.dp)
                    ) {
                        Icon(
                            Icons.Default.Add,
                            contentDescription = null
                        )
                        Text(
                            "+ New chat",
                            modifier = Modifier.padding(start = 8.dp),
                            fontWeight = FontWeight.Black
                        )
                    }

                    OutlinedTextField(
                        value = chatSearch,
                        onValueChange = { chatSearch = it },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 10.dp),
                        placeholder = { Text("Search chats") },
                        leadingIcon = {
                            Icon(
                                Icons.Default.Search,
                                contentDescription = null
                            )
                        },
                        singleLine = true,
                        shape = RoundedCornerShape(18.dp),
                        colors = nexoraOutlinedFieldColors()
                    )

                    Text(
                        "Recent chats",
                        modifier = Modifier.padding(
                            start = 8.dp,
                            top = 14.dp,
                            bottom = 6.dp
                        ),
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )

                    val visibleThreads = chatThreads.filter { thread ->
                        chatSearch.isBlank() ||
                            thread.title.contains(
                                chatSearch.trim(),
                                ignoreCase = true
                            )
                    }

                    LazyColumn(
                        modifier = Modifier.weight(1f),
                        verticalArrangement =
                            Arrangement.spacedBy(5.dp)
                    ) {
                        if (visibleThreads.isEmpty()) {
                            item {
                                Text(
                                    "No matching conversations.",
                                    modifier = Modifier.padding(12.dp),
                                    color = MaterialTheme.colorScheme
                                        .onSurfaceVariant
                                )
                            }
                        }

                        items(
                            visibleThreads,
                            key = { it.id }
                        ) { thread ->
                            val selected =
                                thread.id == activeThreadId &&
                                    screen == NativeScreen.CHAT

                            Surface(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        openThread(thread)
                                    },
                                shape = RoundedCornerShape(16.dp),
                                color = if (selected) {
                                    MaterialTheme.colorScheme
                                        .primaryContainer
                                        .copy(alpha = 0.72f)
                                } else {
                                    Color.Transparent
                                },
                                border = BorderStroke(
                                    1.dp,
                                    if (selected) {
                                        MaterialTheme.colorScheme.primary
                                            .copy(alpha = 0.52f)
                                    } else {
                                        MaterialTheme.colorScheme
                                            .outlineVariant
                                            .copy(alpha = 0.24f)
                                    }
                                )
                            ) {
                                Row(
                                    modifier = Modifier.padding(
                                        horizontal = 11.dp,
                                        vertical = 10.dp
                                    ),
                                    verticalAlignment =
                                        Alignment.CenterVertically,
                                    horizontalArrangement =
                                        Arrangement.spacedBy(10.dp)
                                ) {
                                    Icon(
                                        Icons.Default.Chat,
                                        contentDescription = null,
                                        tint = if (selected) {
                                            MaterialTheme.colorScheme.primary
                                        } else {
                                            MaterialTheme.colorScheme
                                                .onSurfaceVariant
                                        }
                                    )
                                    Column(Modifier.weight(1f)) {
                                        Text(
                                            thread.title,
                                            maxLines = 1,
                                            overflow =
                                                TextOverflow.Ellipsis,
                                            fontWeight = FontWeight.SemiBold,
                                            color = MaterialTheme.colorScheme
                                                .onSurface
                                        )
                                        Text(
                                            formatChatTimestamp(
                                                thread.updatedAt
                                            ),
                                            style = MaterialTheme.typography
                                                .labelSmall,
                                            color = MaterialTheme.colorScheme
                                                .onSurfaceVariant
                                        )
                                    }
                                }
                            }
                        }
                    }

                    Spacer(Modifier.height(8.dp))

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
                        label = { Text("Create Studio") },
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
                        label = { Text("My Projects") },
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
                                if (screen == NativeScreen.CHAT) {
                                    chatThreads.firstOrNull {
                                        it.id == activeThreadId
                                    }?.title ?: "Chat"
                                } else {
                                    screenTitle(screen)
                                },
                                fontWeight = FontWeight.Black,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
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
                    actions = {
                        Surface(
                            modifier = Modifier.padding(end = 12.dp),
                            shape = RoundedCornerShape(999.dp),
                            color = MaterialTheme.colorScheme
                                .primaryContainer.copy(alpha = 0.72f),
                            border = BorderStroke(
                                1.dp,
                                MaterialTheme.colorScheme.primary
                                    .copy(alpha = 0.34f)
                            )
                        ) {
                            Row(
                                modifier = Modifier.padding(
                                    horizontal = 10.dp,
                                    vertical = 6.dp
                                ),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement =
                                    Arrangement.spacedBy(6.dp)
                            ) {
                                Box(
                                    Modifier
                                        .size(7.dp)
                                        .background(
                                            MaterialTheme.colorScheme.primary,
                                            CircleShape
                                        )
                                )
                                Text(
                                    "OMNI",
                                    style = MaterialTheme.typography.labelSmall,
                                    fontWeight = FontWeight.Black,
                                    color = MaterialTheme.colorScheme
                                        .onPrimaryContainer
                                )
                            }
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
                Crossfade(
                    targetState = screen,
                    animationSpec = tween(260),
                    label = "Nexora screen transition"
                ) { destination ->
                    when (destination) {
                        NativeScreen.CHAT -> key(activeThreadId) {
                            ChatScreen(
                                sessionStore = sessionStore,
                                installationId = installationId,
                                threadId = activeThreadId,
                                messages = chatMessages,
                                onThreadChanged = {
                                    chatThreads =
                                        sessionStore.chatThreads()
                                }
                            )
                        }

                        NativeScreen.STUDIO -> StudioScreen(
                            sessionStore,
                            installationId
                        )

                        NativeScreen.PROJECTS -> ProjectWorkspaceScreen(
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
}

private fun formatChatTimestamp(timestamp: Long): String =
    DateUtils.getRelativeTimeSpanString(
        timestamp,
        System.currentTimeMillis(),
        DateUtils.MINUTE_IN_MILLIS,
        DateUtils.FORMAT_ABBREV_RELATIVE
    ).toString()

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
    onProgress: (String, Int) -> Unit
): NativeProjectDetail {
    val token =
        sessionStore.token() ?: error("Session missing")
    val email =
        sessionStore.email() ?: error("Email missing")

    var lastProgress = 2
    onProgress("Starting the website generation engine…", lastProgress)

    val started = NexoraApi.startGeneration(
        token = token,
        installationId = installationId,
        email = email,
        prompt = prompt,
        generationMode = "standard",
        thinkMax = true,
        image = image
    )

    lastProgress = started.progress.coerceIn(2, 8)
    onProgress(
        "Website job created. Connecting the generation worker…",
        lastProgress
    )

    NexoraApi.launchGeneration(
        token = token,
        installationId = installationId,
        email = email,
        prompt = prompt,
        jobId = started.jobId,
        generationMode = "standard",
        thinkMax = true,
        image = image
    )

    lastProgress = lastProgress.coerceAtLeast(10)
    onProgress(
        "Nexora is planning the architecture…",
        lastProgress
    )

    var reconnectFailures = 0

    repeat(400) {
        delay(1500)

        val job = try {
            NexoraApi.getGenerationStatus(
                token = token,
                installationId = installationId,
                email = email,
                jobId = started.jobId
            )
        } catch (statusError: Throwable) {
            reconnectFailures += 1

            if (reconnectFailures >= 8) {
                throw statusError
            }

            onProgress(
                "Generation is still running. Reconnecting… " +
                    "($reconnectFailures/8)",
                lastProgress
            )
            delay(
                (1000L * reconnectFailures).coerceAtMost(8000L)
            )
            return@repeat
        }

        reconnectFailures = 0

        val step = job.currentStep
            ?: job.currentAgent
            ?: job.status

        lastProgress = job.progress.coerceIn(0, 100)
            .coerceAtLeast(lastProgress)
        onProgress(
            "Building your website — " +
                "$lastProgress%\n$step",
            lastProgress
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
    installationId: String,
    threadId: String,
    messages: MutableList<ChatMessage>,
    onThreadChanged: () -> Unit
) {
    val context = LocalContext.current
    var input by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var selectedMode by rememberSaveable {
        mutableStateOf("x0-ultra")
    }
    var showModeSheet by remember {
        mutableStateOf(false)
    }
    var attachment by remember {
        mutableStateOf<SelectedAttachment?>(null)
    }
    var attachmentError by remember {
        mutableStateOf("")
    }
    var voiceError by remember {
        mutableStateOf("")
    }
    var voiceCaptureMode by remember {
        mutableStateOf(VoiceCaptureMode.DICTATION)
    }

    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    val modeSheetState = rememberModalBottomSheetState(
        skipPartiallyExpanded = true
    )

    fun persistConversation() {
        sessionStore.saveChatThread(
            threadId,
            messages.map { it.role to it.text }
        )
        onThreadChanged()
    }

    fun submitMessage(rawRequest: String) {
        val request = rawRequest.trim()
        if (request.isBlank() || loading) {
            return
        }

        val selectedAttachment = attachment

        input = ""
        attachment = null
        attachmentError = ""
        voiceError = ""

        val visibleMessage = if (selectedAttachment != null) {
            request +
                "\n\nAttached: " +
                selectedAttachment.name
        } else {
            request
        }

        val promptWithFile = selectedAttachment
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
        persistConversation()

        if (isWebsiteGenerationRequest(request)) {
            messages += ChatMessage(
                "assistant",
                "Preparing your website…"
            )
            val statusIndex = messages.lastIndex

            scope.launch {
                runCatching {
                    generateWebsiteFromChat(
                        sessionStore,
                        installationId,
                        promptWithFile,
                        selectedAttachment?.asGenerationImage()
                    ) { status, _ ->
                        messages[statusIndex] = ChatMessage(
                            "assistant",
                            status
                        )
                    }
                }.onSuccess { project ->
                    messages[statusIndex] = ChatMessage(
                        "assistant",
                        "Website generated successfully.\n\n" +
                            "Project: ${project.project.name}\n" +
                            "Version: ${project.versionNumber}\n\n" +
                            "Saved in My Projects."
                    )
                }.onFailure {
                    messages[statusIndex] = ChatMessage(
                        "assistant",
                        "Website generation failed:\n" +
                            (it.message ?: "Unknown error")
                    )
                }
                loading = false
                persistConversation()
            }
        } else if (selectedAttachment?.imageBase64 != null) {
            messages += ChatMessage(
                "assistant",
                "The photo is attached. Photo references are " +
                    "currently sent to the website generator. " +
                    "Ask me to build or redesign a website using " +
                    "this photo."
            )
            loading = false
            persistConversation()
        } else {
            scope.launch {
                val response = runCatching {
                    NexoraApi.sendChat(
                        sessionStore.token()
                            ?: error("Session missing"),
                        installationId,
                        sessionStore.username() ?: "Poojak",
                        sessionStore.email()
                            ?: error("Email missing"),
                        promptWithFile,
                        selectedMode,
                        messages
                            .dropLast(1)
                            .takeLast(18)
                            .map { it.role to it.text }
                    )
                }.getOrElse {
                    "Error: " +
                        (it.message ?: "Chat request failed")
                }

                messages += ChatMessage(
                    "assistant",
                    response
                )
                loading = false
                persistConversation()
            }
        }
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

    val speechLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode != Activity.RESULT_OK) {
            return@rememberLauncherForActivityResult
        }

        val transcript = result.data
            ?.getStringArrayListExtra(
                RecognizerIntent.EXTRA_RESULTS
            )
            ?.firstOrNull()
            ?.trim()
            .orEmpty()

        if (transcript.isBlank()) {
            voiceError = "No speech was recognised. Please try again."
        } else if (
            voiceCaptureMode == VoiceCaptureMode.DICTATION
        ) {
            input = listOf(input.trim(), transcript)
                .filter { it.isNotBlank() }
                .joinToString(" ")
            voiceError = ""
        } else {
            submitMessage(transcript)
        }
    }

    fun startSpeechCapture(mode: VoiceCaptureMode) {
        voiceCaptureMode = mode
        voiceError = ""

        val intent = Intent(
            RecognizerIntent.ACTION_RECOGNIZE_SPEECH
        ).apply {
            putExtra(
                RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
            )
            putExtra(
                RecognizerIntent.EXTRA_LANGUAGE,
                Locale.getDefault().toLanguageTag()
            )
            putExtra(
                RecognizerIntent.EXTRA_PROMPT,
                if (mode == VoiceCaptureMode.DICTATION) {
                    "Dictate a message for Nexora"
                } else {
                    "Ask Nexora"
                }
            )
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }

        runCatching {
            speechLauncher.launch(intent)
        }.onFailure {
            voiceError =
                "Android speech recognition is not available on this device."
        }
    }

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) {
            listState.animateScrollToItem(
                messages.lastIndex
            )
        }
    }

    val latestMessageText = messages.lastOrNull()?.text
    LaunchedEffect(
        threadId,
        messages.size,
        latestMessageText
    ) {
        delay(300)
        sessionStore.saveChatThread(
            threadId,
            messages.map { it.role to it.text }
        )
        onThreadChanged()
    }

    if (showModeSheet) {
        ModalBottomSheet(
            onDismissRequest = { showModeSheet = false },
            sheetState = modeSheetState,
            containerColor = MaterialTheme.colorScheme.surface,
            contentColor = MaterialTheme.colorScheme.onSurface
        ) {
            Column(
                modifier = Modifier.padding(
                    start = 18.dp,
                    end = 18.dp,
                    bottom = 28.dp
                ),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text(
                    "Choose a Nexora mode",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Black
                )
                Text(
                    "The backend model IDs remain unchanged.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                NexoraModes.forEach { mode ->
                    val selected = selectedMode == mode.id
                    Surface(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                if (!loading) {
                                    selectedMode = mode.id
                                    showModeSheet = false
                                }
                            },
                        shape = RoundedCornerShape(20.dp),
                        color = if (selected) {
                            MaterialTheme.colorScheme.primaryContainer
                                .copy(alpha = 0.78f)
                        } else {
                            MaterialTheme.colorScheme.surfaceVariant
                                .copy(alpha = 0.52f)
                        },
                        border = BorderStroke(
                            1.dp,
                            if (selected) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.outlineVariant
                            }
                        )
                    ) {
                        Row(
                            modifier = Modifier.padding(16.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement =
                                Arrangement.spacedBy(12.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(10.dp)
                                    .background(
                                        if (selected) {
                                            MaterialTheme.colorScheme.primary
                                        } else {
                                            MaterialTheme.colorScheme
                                                .outline
                                        },
                                        CircleShape
                                    )
                            )
                            Column(Modifier.weight(1f)) {
                                Text(
                                    mode.name,
                                    fontWeight = FontWeight.Black
                                )
                                Text(
                                    mode.description,
                                    style =
                                        MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme
                                        .onSurfaceVariant
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    Column(
        modifier = Modifier.fillMaxSize()
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
                            Modifier
                                .widthIn(max = 330.dp)
                                .animateContentSize(),
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
                                    .surface
                                    .copy(alpha = 0.94f)
                            },
                        contentColor =
                            if (message.role == "user") {
                                MaterialTheme.colorScheme
                                    .onPrimaryContainer
                            } else {
                                MaterialTheme.colorScheme
                                    .onSurface
                            },
                        shadowElevation =
                            if (message.role == "user") 14.dp else 10.dp,
                        tonalElevation = 8.dp,
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
                                        .bodyLarge,
                                color = if (message.role == "user") {
                                    MaterialTheme.colorScheme
                                        .onPrimaryContainer
                                } else {
                                    MaterialTheme.colorScheme.onSurface
                                }
                            )
                        }
                    }
                }
            }

            if (
                loading &&
                messages.lastOrNull()?.role == "user"
            ) {
                item {
                    Surface(
                        shape = RoundedCornerShape(20.dp),
                        color = MaterialTheme.colorScheme.surface
                            .copy(alpha = 0.90f),
                        contentColor = MaterialTheme.colorScheme.onSurface,
                        border = BorderStroke(
                            1.dp,
                            MaterialTheme.colorScheme.secondary
                                .copy(alpha = 0.30f)
                        )
                    ) {
                        Row(
                            modifier = Modifier.padding(
                                horizontal = 14.dp,
                                vertical = 11.dp
                            ),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement =
                                Arrangement.spacedBy(10.dp)
                        ) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                strokeWidth = 2.dp
                            )
                            Text(
                                when (selectedMode) {
                                    "x0-ultra" ->
                                        "Nexora Apex is reasoning…"
                                    "y1" ->
                                        "Nexora Core is working…"
                                    else ->
                                        "Nexora Swift is responding…"
                                },
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme
                                    .onSurfaceVariant
                            )
                        }
                    }
                }
            }
        }

        GlassPanel(
            modifier = Modifier
                .fillMaxWidth()
                .imePadding()
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
                OutlinedButton(
                    enabled = !loading,
                    onClick = { showModeSheet = true },
                    shape = RoundedCornerShape(16.dp)
                ) {
                    Text(
                        NexoraModes.first {
                            it.id == selectedMode
                        }.name,
                        fontWeight = FontWeight.Black
                    )
                    Icon(
                        Icons.Default.KeyboardArrowDown,
                        contentDescription = "Choose Nexora mode",
                        modifier = Modifier.padding(start = 5.dp)
                    )
                }

                attachment?.let { selected ->
                    Surface(
                        shape = RoundedCornerShape(16.dp),
                        color = MaterialTheme.colorScheme
                            .secondaryContainer
                            .copy(alpha = 0.78f),
                        contentColor = MaterialTheme.colorScheme
                            .onSecondaryContainer
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

                if (voiceError.isNotBlank()) {
                    Text(
                        voiceError,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall
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
                        shape = RoundedCornerShape(22.dp),
                        colors = nexoraTextFieldColors(),
                        trailingIcon = {
                            IconButton(
                                enabled = !loading,
                                onClick = {
                                    startSpeechCapture(
                                        VoiceCaptureMode.DICTATION
                                    )
                                }
                            ) {
                                Icon(
                                    Icons.Default.Mic,
                                    contentDescription =
                                        "Dictate into message"
                                )
                            }
                        }
                    )

                    Button(
                        enabled = !loading,
                        onClick = {
                            if (input.isNotBlank()) {
                                submitMessage(input)
                            } else {
                                startSpeechCapture(
                                    VoiceCaptureMode.VOICE_ASK
                                )
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
                                if (input.isNotBlank()) {
                                    Icons.Default.Send
                                } else {
                                    Icons.Default.GraphicEq
                                },
                                contentDescription =
                                    if (input.isNotBlank()) {
                                        "Send message"
                                    } else {
                                        "Voice Ask"
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
fun GenerationScreen(
    sessionStore: SessionStore,
    installationId: String
) {
    val context = LocalContext.current
    var prompt by remember { mutableStateOf("") }
    var thinkMax by remember { mutableStateOf(true) }
    var running by remember { mutableStateOf(false) }
    var progress by remember { mutableStateOf(0) }
    var status by remember { mutableStateOf("Ready") }
    var errorText by remember { mutableStateOf("") }
    var attachment by remember {
        mutableStateOf<SelectedAttachment?>(null)
    }
    var result by remember {
        mutableStateOf<NativeProjectDetail?>(null)
    }
    val animatedProgress by animateFloatAsState(
        targetValue = progress.coerceIn(0, 100) / 100f,
        animationSpec = tween(480),
        label = "Website generation progress"
    )
    val scope = rememberCoroutineScope()
    val attachmentLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri != null) {
            runCatching {
                readSelectedAttachment(context, uri)
            }.onSuccess {
                attachment = it
                errorText = ""
            }.onFailure {
                attachment = null
                errorText = it.message ?: "Attachment failed."
            }
        }
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .imePadding(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            GlassPanel(Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(18.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Surface(
                        shape = RoundedCornerShape(999.dp),
                        color = MaterialTheme.colorScheme
                            .primaryContainer.copy(alpha = 0.74f)
                    ) {
                        Text(
                            "OMNIROUTE WEBSITE ENGINE",
                            modifier = Modifier.padding(
                                horizontal = 11.dp,
                                vertical = 6.dp
                            ),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme
                                .onPrimaryContainer
                        )
                    }
                    Text(
                        "Create a production-ready website",
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Black
                    )
                    Text(
                        "Describe the business, pages, visual style, " +
                            "features and content. Nexora will plan, " +
                            "build and verify the result.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
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
                        maxLines = 10,
                        colors = nexoraOutlinedFieldColors()
                    )

                    attachment?.let { selected ->
                        Surface(
                            shape = RoundedCornerShape(16.dp),
                            color = MaterialTheme.colorScheme
                                .secondaryContainer.copy(alpha = 0.76f),
                            contentColor = MaterialTheme.colorScheme
                                .onSecondaryContainer
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(start = 10.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    Icons.Default.AttachFile,
                                    contentDescription = null
                                )
                                Column(
                                    modifier = Modifier
                                        .weight(1f)
                                        .padding(
                                            horizontal = 9.dp,
                                            vertical = 8.dp
                                        )
                                ) {
                                    Text(
                                        selected.name,
                                        style = MaterialTheme
                                            .typography.bodyMedium,
                                        fontWeight = FontWeight.SemiBold,
                                        maxLines = 1
                                    )
                                    Text(
                                        if (selected.imageBase64 != null) {
                                            "Visual reference"
                                        } else {
                                            "Text/code context"
                                        },
                                        style = MaterialTheme
                                            .typography.labelSmall
                                    )
                                }
                                IconButton(
                                    enabled = !running,
                                    onClick = { attachment = null }
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

                    OutlinedButton(
                        enabled = !running,
                        onClick = {
                            attachmentLauncher.launch(arrayOf("*/*"))
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(
                            Icons.Default.AttachFile,
                            contentDescription = null
                        )
                        Text(
                            if (attachment == null) {
                                "  Add photo or text/code file"
                            } else {
                                "  Replace attachment"
                            }
                        )
                    }

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
                            val rawRequest = prompt.trim()
                            val selectedAttachment = attachment
                            val request = selectedAttachment
                                ?.textContent
                                ?.let { fileText ->
                                    rawRequest +
                                        "\n\nReference file: " +
                                        selectedAttachment.name +
                                        "\n---\n" + fileText
                                }
                                ?: rawRequest
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
                                            thinkMax,
                                            selectedAttachment
                                                ?.asGenerationImage()
                                        )

                                    status = started.status
                                    progress = started.progress

                                    status =
                                        "Connecting the generation worker"
                                    NexoraApi.launchGeneration(
                                        token = token,
                                        installationId = installationId,
                                        email = email,
                                        prompt = request,
                                        jobId = started.jobId,
                                        generationMode = "standard",
                                        thinkMax = thinkMax,
                                        image = selectedAttachment
                                            ?.asGenerationImage()
                                    )
                                    progress = progress.coerceAtLeast(10)
                                    status =
                                        "Nexora is planning the website"

                                    var reconnectFailures = 0

                                    repeat(400) {
                                        delay(1500)

                                        val job = try {
                                            NexoraApi
                                                .getGenerationStatus(
                                                    token,
                                                    installationId,
                                                    email,
                                                    started.jobId
                                                )
                                        } catch (statusError: Throwable) {
                                            reconnectFailures += 1
                                            if (reconnectFailures >= 8) {
                                                throw statusError
                                            }
                                            status =
                                                "Reconnecting to the job " +
                                                    "($reconnectFailures/8)"
                                            delay(
                                                (1000L * reconnectFailures)
                                                    .coerceAtMost(8000L)
                                            )
                                            return@repeat
                                        }

                                        reconnectFailures = 0

                                        status =
                                            job.currentStep
                                                ?: job.currentAgent
                                                ?: job.status
                                        progress =
                                            job.progress.coerceIn(
                                                0,
                                                100
                                            ).coerceAtLeast(progress)

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
                                                attachment = null
                                                progress = 100
                                                status = "Website ready"
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
                            progress = { animatedProgress },
                            modifier = Modifier.fillMaxWidth()
                        )
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement =
                                Arrangement.spacedBy(6.dp)
                        ) {
                            listOf(
                                "Plan" to 10,
                                "Design" to 30,
                                "Build" to 55,
                                "Verify" to 85
                            ).forEach { (label, threshold) ->
                                Surface(
                                    modifier = Modifier.weight(1f),
                                    shape = RoundedCornerShape(999.dp),
                                    color = if (progress >= threshold) {
                                        MaterialTheme.colorScheme
                                            .primaryContainer
                                    } else {
                                        MaterialTheme.colorScheme
                                            .surfaceVariant
                                    },
                                    contentColor = if (
                                        progress >= threshold
                                    ) {
                                        MaterialTheme.colorScheme
                                            .onPrimaryContainer
                                    } else {
                                        MaterialTheme.colorScheme
                                            .onSurfaceVariant
                                    }
                                ) {
                                    Text(
                                        label,
                                        modifier = Modifier.padding(
                                            horizontal = 6.dp,
                                            vertical = 5.dp
                                        ),
                                        style = MaterialTheme
                                            .typography.labelSmall
                                    )
                                }
                            }
                        }
                        Text(
                            "$status — $progress%",
                            color = MaterialTheme.colorScheme
                                .onSurfaceVariant
                        )
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
                        singleLine = true,
                        colors = nexoraOutlinedFieldColors()
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
                            PasswordVisualTransformation(),
                        colors = nexoraOutlinedFieldColors()
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
                .horizontalScroll(rememberScrollState())
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

            FilterChip(
                selected = section == "billing",
                onClick = { section = "billing" },
                label = { Text("Billing") }
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

        if (section == "billing") {
            AdminBillingSection(
                token = token,
                accounts = accounts,
                onReload = { load(token) }
            )
        } else if (section == "overview") {
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
                                singleLine = true,
                                colors = nexoraOutlinedFieldColors()
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
                                    PasswordVisualTransformation(),
                                colors = nexoraOutlinedFieldColors()
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
                                        PasswordVisualTransformation(),
                                    colors = nexoraOutlinedFieldColors()
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
