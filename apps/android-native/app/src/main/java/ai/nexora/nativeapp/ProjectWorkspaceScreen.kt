package ai.nexora.nativeapp

import ai.nexora.nativeapp.data.NativeCmsDocument
import ai.nexora.nativeapp.data.NativeCmsWorkspace
import ai.nexora.nativeapp.data.NativeProject
import ai.nexora.nativeapp.data.NativeProjectDetail
import ai.nexora.nativeapp.data.NativeProjectSource
import ai.nexora.nativeapp.data.NexoraApi
import ai.nexora.nativeapp.data.SessionStore
import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color as AndroidColor
import android.net.Uri
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.OpenInFull
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.launch
import org.json.JSONObject

@Composable
internal fun ProjectWorkspaceScreen(
    sessionStore: SessionStore,
    installationId: String
) {
    val scope = rememberCoroutineScope()
    var projects by remember {
        mutableStateOf<List<NativeProject>>(emptyList())
    }
    var selected by remember {
        mutableStateOf<NativeProjectDetail?>(null)
    }
    var loading by remember { mutableStateOf(true) }
    var errorText by remember { mutableStateOf("") }

    fun token(): String =
        sessionStore.token() ?: error("Session missing")

    fun email(): String =
        sessionStore.email() ?: error("Email missing")

    fun loadProjects() {
        loading = true
        errorText = ""
        scope.launch {
            runCatching {
                NexoraApi.listProjects(
                    token(),
                    installationId,
                    email()
                )
            }.onSuccess {
                projects = it
            }.onFailure {
                errorText = it.message
                    ?: "Could not load projects."
            }
            loading = false
        }
    }

    fun openProject(project: NativeProject) {
        loading = true
        errorText = ""
        scope.launch {
            runCatching {
                NexoraApi.getProject(
                    token(),
                    installationId,
                    email(),
                    project.id
                )
            }.onSuccess {
                selected = it
            }.onFailure {
                errorText = it.message
                    ?: "Could not open project."
            }
            loading = false
        }
    }

    LaunchedEffect(Unit) {
        loadProjects()
    }

    val detail = selected
    if (detail == null) {
        ProjectListPane(
            projects = projects,
            loading = loading,
            errorText = errorText,
            onRefresh = ::loadProjects,
            onOpen = ::openProject
        )
    } else {
        ProjectDetailPane(
            detail = detail,
            sessionStore = sessionStore,
            installationId = installationId,
            onBack = { selected = null },
            onRefresh = {
                openProject(detail.project)
            }
        )
    }
}

@Composable
private fun ProjectListPane(
    projects: List<NativeProject>,
    loading: Boolean,
    errorText: String,
    onRefresh: () -> Unit,
    onOpen: (NativeProject) -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 14.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 10.dp),
            verticalAlignment =
                androidx.compose.ui.Alignment.CenterVertically
        ) {
            Text(
                "Your generated websites",
                style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.weight(1f),
                fontWeight = FontWeight.Black,
                color = MaterialTheme.colorScheme.onSurface
            )
            IconButton(onClick = onRefresh) {
                Icon(
                    Icons.Default.Refresh,
                    contentDescription = "Refresh",
                    tint = MaterialTheme.colorScheme.onSurface
                )
            }
        }

        Text(
            "Rendered previews, complete source files and CMS content.",
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        if (loading) {
            LinearProgressIndicator(
                Modifier.fillMaxWidth()
            )
        }

        if (errorText.isNotBlank()) {
            Text(
                errorText,
                modifier = Modifier.padding(vertical = 8.dp),
                color = MaterialTheme.colorScheme.error
            )
        }

        LazyColumn(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            contentPadding = PaddingValues(vertical = 12.dp)
        ) {
            if (!loading && projects.isEmpty()) {
                item {
                    GlassPanel(Modifier.fillMaxWidth()) {
                        Text(
                            "No projects yet. Create one from Chat or Studio.",
                            modifier = Modifier.padding(18.dp),
                            color = MaterialTheme.colorScheme.onSurface
                        )
                    }
                }
            }

            items(projects, key = { it.id }) { project ->
                GlassPanel(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onOpen(project) }
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement =
                            Arrangement.spacedBy(5.dp)
                    ) {
                        Text(
                            project.name,
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Black,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                        Text(
                            "${project.websiteType} · ${project.framework}",
                            color = MaterialTheme.colorScheme.secondary
                        )
                        Text(
                            project.status.replace('_', ' '),
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ProjectDetailPane(
    detail: NativeProjectDetail,
    sessionStore: SessionStore,
    installationId: String,
    onBack: () -> Unit,
    onRefresh: () -> Unit
) {
    var section by remember(detail.project.id) {
        mutableStateOf("preview")
    }
    var fullPreviewOpen by remember(detail.project.id) {
        mutableStateOf(false)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 14.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment =
                androidx.compose.ui.Alignment.CenterVertically
        ) {
            TextButton(onClick = onBack) {
                Text("← Projects")
            }
            Text(
                detail.project.name,
                modifier = Modifier.weight(1f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Black,
                color = MaterialTheme.colorScheme.onSurface
            )
            IconButton(onClick = onRefresh) {
                Icon(
                    Icons.Default.Refresh,
                    contentDescription = "Refresh project"
                )
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            listOf(
                "preview" to "Preview",
                "files" to "Source files",
                "cms" to "CMS"
            ).forEach { (value, label) ->
                FilterChip(
                    selected = section == value,
                    onClick = { section = value },
                    label = { Text(label) }
                )
            }
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
        ) {
            when (section) {
                "files" -> ProjectSourcePane(
                    detail,
                    sessionStore,
                    installationId
                )

                "cms" -> ProjectCmsPane(
                    detail.project,
                    sessionStore,
                    installationId
                )

                else -> ProjectPreviewPane(
                    detail = detail,
                    onOpenFullPreview = {
                        fullPreviewOpen = true
                    }
                )
            }
        }
    }

    if (fullPreviewOpen) {
        FullScreenProjectPreview(
            detail = detail,
            onClose = { fullPreviewOpen = false }
        )
    }
}

@Composable
private fun ProjectPreviewPane(
    detail: NativeProjectDetail,
    onOpenFullPreview: () -> Unit
) {
    var reloadKey by remember(
        detail.project.id,
        detail.versionNumber
    ) {
        mutableStateOf(0)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        GlassPanel(Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(5.dp)
            ) {
                Text(
                    "Rendered website preview",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Black,
                    color = MaterialTheme.colorScheme.onSurface
                )
                Text(
                    "Version ${detail.versionNumber} · " +
                        detail.fileCount
                            .coerceAtLeast(detail.filePaths.size)
                            .takeIf { it > 0 }
                            ?.let { "$it source files" }
                            .orEmpty()
                            .ifBlank {
                                "Complete source available"
                            },
                    color = MaterialTheme.colorScheme.secondary
                )
                Text(
                    "${detail.project.websiteType} · " +
                        "${detail.project.framework} · " +
                        detail.project.status.replace('_', ' '),
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }

        if (detail.previewHtml.isBlank()) {
            GlassPanel(Modifier.fillMaxWidth()) {
                Text(
                    "No visual preview is available for this version. " +
                        "The complete project is still available under " +
                        "Source files.",
                    modifier = Modifier.padding(18.dp),
                    color = MaterialTheme.colorScheme.onSurface
                )
            }
        } else {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Button(
                    onClick = onOpenFullPreview,
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(16.dp)
                ) {
                    Icon(
                        Icons.Default.OpenInFull,
                        contentDescription = null
                    )
                    Text(
                        "Open Full Preview",
                        modifier = Modifier.padding(start = 7.dp)
                    )
                }
                OutlinedButton(
                    onClick = { reloadKey += 1 },
                    shape = RoundedCornerShape(16.dp)
                ) {
                    Icon(
                        Icons.Default.Refresh,
                        contentDescription = "Reload preview"
                    )
                }
            }

            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
                shape = RoundedCornerShape(24.dp),
                color = Color.White,
                border = BorderStroke(
                    1.dp,
                    MaterialTheme.colorScheme.outlineVariant
                ),
                shadowElevation = 10.dp
            ) {
                ProjectWebPreview(
                    html = detail.previewHtml,
                    reloadKey = reloadKey
                )
            }
        }
    }
}

@Composable
private fun FullScreenProjectPreview(
    detail: NativeProjectDetail,
    onClose: () -> Unit
) {
    var reloadKey by remember(
        detail.project.id,
        detail.versionNumber
    ) {
        mutableStateOf(0)
    }

    Dialog(
        onDismissRequest = onClose,
        properties = DialogProperties(
            dismissOnBackPress = true,
            dismissOnClickOutside = false,
            usePlatformDefaultWidth = false,
            decorFitsSystemWindows = false
        )
    ) {
        Surface(
            modifier = Modifier
                .fillMaxSize()
                .safeDrawingPadding(),
            color = MaterialTheme.colorScheme.background
        ) {
            Column(Modifier.fillMaxSize()) {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    color = MaterialTheme.colorScheme.surface,
                    shadowElevation = 8.dp
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(
                                horizontal = 8.dp,
                                vertical = 6.dp
                            ),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        IconButton(onClick = onClose) {
                            Icon(
                                Icons.Default.ArrowBack,
                                contentDescription = "Back to project"
                            )
                        }
                        Column(Modifier.weight(1f)) {
                            Text(
                                detail.project.name,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                fontWeight = FontWeight.Black,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                            Text(
                                "Full website preview",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme
                                    .onSurfaceVariant
                            )
                        }
                        IconButton(onClick = { reloadKey += 1 }) {
                            Icon(
                                Icons.Default.Refresh,
                                contentDescription = "Reload website"
                            )
                        }
                    }
                }

                ProjectWebPreview(
                    html = detail.previewHtml,
                    reloadKey = reloadKey,
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                )
            }
        }
    }
}

private const val PreviewBaseUrl =
    "https://preview.nexora.invalid/"

private fun preparePreviewHtml(rawHtml: String): String {
    val html = rawHtml.trim()
    val viewport =
        "<meta name=\"viewport\" " +
            "content=\"width=device-width, initial-scale=1, " +
            "viewport-fit=cover\">"

    if (
        Regex(
            "<meta[^>]+name=[\\\"']viewport[\\\"']",
            RegexOption.IGNORE_CASE
        ).containsMatchIn(html)
    ) {
        return html
    }

    val head = Regex(
        "<head(?:\\s[^>]*)?>",
        RegexOption.IGNORE_CASE
    )

    val headMatch = head.find(html)
    if (headMatch != null) {
        return html.replaceRange(
            headMatch.range,
            headMatch.value + viewport
        )
    }

    val htmlElement = Regex(
        "<html(?:\\s[^>]*)?>",
        RegexOption.IGNORE_CASE
    ).find(html)

    return if (htmlElement != null) {
        html.replaceRange(
            htmlElement.range,
            htmlElement.value + "<head>$viewport</head>"
        )
    } else {
        "<!doctype html><html><head>$viewport</head>" +
            "<body>$html</body></html>"
    }
}

private fun previewNeedsJavaScript(html: String): Boolean =
    Regex(
        "<script\\b|\\son[a-z]+\\s*=|javascript:",
        RegexOption.IGNORE_CASE
    ).containsMatchIn(html)

private fun previewNeedsDomStorage(html: String): Boolean =
    Regex(
        "\\b(?:localStorage|sessionStorage|indexedDB)\\b",
        RegexOption.IGNORE_CASE
    ).containsMatchIn(html)

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun ProjectWebPreview(
    html: String,
    reloadKey: Int,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    var loading by remember(html, reloadKey) {
        mutableStateOf(true)
    }
    var errorText by remember(html, reloadKey) {
        mutableStateOf("")
    }
    val previewHost = remember {
        Uri.parse(PreviewBaseUrl).host
    }

    fun openExternalLink(uri: Uri) {
        runCatching {
            context.startActivity(
                Intent(
                    Intent.ACTION_VIEW,
                    uri
                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        }.onFailure {
            errorText = "No app can open this link."
        }
    }

    val webView = remember(context) {
        WebView(context).apply {
            setBackgroundColor(AndroidColor.WHITE)
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.databaseEnabled = false
            settings.allowFileAccessFromFileURLs = false
            settings.allowUniversalAccessFromFileURLs = false
            settings.setSupportMultipleWindows(false)
            settings.javaScriptCanOpenWindowsAutomatically = false
            settings.mediaPlaybackRequiresUserGesture = true
            settings.safeBrowsingEnabled = true
            settings.cacheMode = WebSettings.LOAD_NO_CACHE
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = false
            settings.mixedContentMode =
                WebSettings.MIXED_CONTENT_NEVER_ALLOW
            webViewClient = object : WebViewClient() {
                override fun onPageStarted(
                    view: WebView?,
                    url: String?,
                    favicon: Bitmap?
                ) {
                    loading = true
                    errorText = ""
                }

                override fun onPageFinished(
                    view: WebView?,
                    url: String?
                ) {
                    loading = false
                }

                override fun shouldOverrideUrlLoading(
                    view: WebView?,
                    request: WebResourceRequest?
                ): Boolean {
                    if (request?.isForMainFrame != true) {
                        return false
                    }

                    val uri = request.url ?: return true
                    return when (uri.scheme?.lowercase()) {
                        "about" -> false
                        "https" -> {
                            if (
                                uri.host?.equals(
                                    previewHost,
                                    ignoreCase = true
                                ) == true
                            ) {
                                false
                            } else {
                                openExternalLink(uri)
                                true
                            }
                        }
                        "mailto", "tel" -> {
                            openExternalLink(uri)
                            true
                        }
                        else -> {
                            errorText =
                                "Blocked an unsafe preview link."
                            true
                        }
                    }
                }

                override fun onReceivedError(
                    view: WebView?,
                    request: WebResourceRequest?,
                    error: WebResourceError?
                ) {
                    if (request?.isForMainFrame == true) {
                        loading = false
                        errorText = error?.description
                            ?.toString()
                            ?.take(240)
                            .orEmpty()
                            .ifBlank {
                                "The preview could not load this page."
                            }
                    }
                }
            }
        }
    }

    LaunchedEffect(html, reloadKey) {
        val prepared = preparePreviewHtml(html)
        webView.settings.javaScriptEnabled =
            previewNeedsJavaScript(prepared)
        webView.settings.domStorageEnabled =
            previewNeedsDomStorage(prepared)
        webView.settings.databaseEnabled =
            previewNeedsDomStorage(prepared)
        loading = true
        errorText = ""
        webView.loadDataWithBaseURL(
            PreviewBaseUrl,
            prepared,
            "text/html",
            Charsets.UTF_8.name(),
            null
        )
    }

    DisposableEffect(webView) {
        onDispose {
            webView.stopLoading()
            webView.loadUrl("about:blank")
            webView.clearHistory()
            webView.removeAllViews()
            webView.destroy()
        }
    }

    Box(modifier = modifier.fillMaxSize()) {
        AndroidView(
            factory = { webView },
            modifier = Modifier.fillMaxSize()
        )

        if (loading) {
            LinearProgressIndicator(
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .fillMaxWidth()
            )
        }

        if (errorText.isNotBlank()) {
            Surface(
                modifier = Modifier
                    .align(Alignment.Center)
                    .padding(20.dp),
                shape = RoundedCornerShape(18.dp),
                color = MaterialTheme.colorScheme.errorContainer,
                contentColor = MaterialTheme.colorScheme.onErrorContainer,
                shadowElevation = 10.dp
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        "Preview could not open this page",
                        fontWeight = FontWeight.Black
                    )
                    Text(
                        errorText,
                        style = MaterialTheme.typography.bodySmall
                    )
                    OutlinedButton(
                        onClick = {
                            errorText = ""
                            loading = true
                            webView.loadDataWithBaseURL(
                                PreviewBaseUrl,
                                preparePreviewHtml(html),
                                "text/html",
                                Charsets.UTF_8.name(),
                                null
                            )
                        }
                    ) {
                        Text("Reload preview")
                    }
                }
            }
        }
    }
}

@Composable
private fun ProjectSourcePane(
    detail: NativeProjectDetail,
    sessionStore: SessionStore,
    installationId: String
) {
    val scope = rememberCoroutineScope()
    var source by remember(detail.project.id) {
        mutableStateOf<NativeProjectSource?>(null)
    }
    var selectedPath by remember(detail.project.id) {
        mutableStateOf("")
    }
    var loading by remember(detail.project.id) {
        mutableStateOf(true)
    }
    var errorText by remember(detail.project.id) {
        mutableStateOf("")
    }

    suspend fun loadSource() {
        loading = true
        errorText = ""
        runCatching {
            NexoraApi.getProjectSource(
                sessionStore.token()
                    ?: error("Session missing"),
                installationId,
                sessionStore.email()
                    ?: error("Email missing"),
                detail.project.id
            )
        }.onSuccess {
            source = it
            if (
                selectedPath.isBlank() ||
                it.files.none { file ->
                    file.path == selectedPath
                }
            ) {
                selectedPath = it.files.firstOrNull()?.path
                    .orEmpty()
            }
        }.onFailure {
            errorText = it.message
                ?: "Could not load project source."
        }
        loading = false
    }

    LaunchedEffect(detail.project.id) {
        loadSource()
    }

    val selectedFile = source?.files?.firstOrNull {
        it.path == selectedPath
    }
    val listState = rememberLazyListState()

    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        item {
            GlassPanel(Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(5.dp)
                ) {
                    Text(
                        "Production project source",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Black,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    Text(
                        "This is the actual multi-file project—not the HTML preview.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        "${source?.files?.size ?: detail.fileCount} files",
                        color = MaterialTheme.colorScheme.secondary
                    )
                }
            }
        }

        if (loading) {
            item {
                LinearProgressIndicator(Modifier.fillMaxWidth())
            }
        }

        if (errorText.isNotBlank()) {
            item {
                Text(
                    errorText,
                    color = MaterialTheme.colorScheme.error
                )
                TextButton(onClick = {
                    scope.launch { loadSource() }
                }) {
                    Text("Retry")
                }
            }
        }

        selectedFile?.let { file ->
            item {
                GlassPanel(Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier.padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text(
                            file.path,
                            fontWeight = FontWeight.Black,
                            color = MaterialTheme.colorScheme.primary
                        )
                        SelectionContainer {
                            Text(
                                file.content.take(50_000),
                                fontFamily = FontFamily.Monospace,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                        }
                        if (file.content.length > 50_000) {
                            Text(
                                "Display limited to the first 50,000 characters for app performance.",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                    }
                }
            }
        }

        source?.let { projectSource ->
            items(
                projectSource.files,
                key = { it.path }
            ) { file ->
                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable {
                            selectedPath = file.path
                            scope.launch {
                                listState.animateScrollToItem(0)
                            }
                        },
                    shape = RoundedCornerShape(14.dp),
                    color = if (selectedPath == file.path) {
                        MaterialTheme.colorScheme.primaryContainer
                    } else {
                        MaterialTheme.colorScheme.surface
                    },
                    border = BorderStroke(
                        1.dp,
                        if (selectedPath == file.path) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.outlineVariant
                        }
                    )
                ) {
                    Text(
                        file.path,
                        modifier = Modifier.padding(12.dp),
                        fontFamily = FontFamily.Monospace,
                        color = if (selectedPath == file.path) {
                            MaterialTheme.colorScheme.onPrimaryContainer
                        } else {
                            MaterialTheme.colorScheme.onSurface
                        }
                    )
                }
            }
        }
    }
}

private fun cmsSlugify(value: String): String =
    value.lowercase()
        .trim()
        .replace(Regex("[^a-z0-9]+"), "-")
        .trim('-')
        .take(120)

@Composable
private fun ProjectCmsPane(
    project: NativeProject,
    sessionStore: SessionStore,
    installationId: String
) {
    val scope = rememberCoroutineScope()
    var workspace by remember(project.id) {
        mutableStateOf<NativeCmsWorkspace?>(null)
    }
    var loading by remember(project.id) {
        mutableStateOf(true)
    }
    var errorText by remember(project.id) {
        mutableStateOf("")
    }
    var message by remember(project.id) {
        mutableStateOf("")
    }
    var editingId by remember(project.id) {
        mutableStateOf("")
    }
    var title by remember(project.id) {
        mutableStateOf("")
    }
    var slug by remember(project.id) {
        mutableStateOf("")
    }
    var collection by remember(project.id) {
        mutableStateOf("pages")
    }
    var contentJson by remember(project.id) {
        mutableStateOf("{}")
    }
    var documentStatus by remember(project.id) {
        mutableStateOf("draft")
    }
    var deleteConfirmId by remember(project.id) {
        mutableStateOf("")
    }

    fun token(): String =
        sessionStore.token() ?: error("Session missing")

    fun email(): String =
        sessionStore.email() ?: error("Email missing")

    suspend fun refreshCms() {
        workspace = NexoraApi.getCmsWorkspace(
            token(),
            installationId,
            email(),
            project.id
        )
    }

    fun runTask(
        successMessage: String = "",
        block: suspend () -> Unit
    ) {
        loading = true
        errorText = ""
        message = ""
        scope.launch {
            try {
                block()
                if (successMessage.isNotBlank()) {
                    message = successMessage
                }
            } catch (error: Throwable) {
                errorText = error.message
                    ?: "CMS operation failed."
            } finally {
                loading = false
            }
        }
    }

    fun editDocument(document: NativeCmsDocument) {
        editingId = document.id
        title = document.title
        slug = document.slug
        collection = document.collection
        contentJson = document.contentJson
        documentStatus = document.status
        deleteConfirmId = ""
        errorText = ""
        message = ""
    }

    fun createDocument() {
        editingId = "new"
        title = ""
        slug = ""
        collection = "pages"
        contentJson = "{\n  \"heading\": \"\",\n  \"body\": \"\"\n}"
        documentStatus = "draft"
        deleteConfirmId = ""
        errorText = ""
        message = ""
    }

    LaunchedEffect(project.id) {
        try {
            refreshCms()
        } catch (error: Throwable) {
            errorText = error.message
                ?: "Could not load CMS."
        } finally {
            loading = false
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        item {
            GlassPanel(Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Text(
                        "Nexora CMS",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Black,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    Text(
                        "Manage live pages, products, posts, services and settings. " +
                            "Publish once after enabling CMS; later content changes update without a rebuild.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    workspace?.settings?.let { settings ->
                        Text(
                            "Live slug: ${settings.publicSlug} · Content v${settings.contentVersion}",
                            color = MaterialTheme.colorScheme.secondary
                        )
                    }
                }
            }
        }

        if (loading) {
            item {
                LinearProgressIndicator(Modifier.fillMaxWidth())
            }
        }

        if (message.isNotBlank()) {
            item {
                Text(
                    message,
                    color = MaterialTheme.colorScheme.primary
                )
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

        val settings = workspace?.settings
        if (!loading && settings?.enabled != true) {
            item {
                Button(
                    modifier = Modifier.fillMaxWidth(),
                    onClick = {
                        runTask("CMS enabled.") {
                            workspace = NexoraApi.bootstrapCms(
                                token(),
                                installationId,
                                email(),
                                project.id
                            )
                        }
                    }
                ) {
                    Text("Enable CMS for this project")
                }
            }
        } else if (settings?.enabled == true) {
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Button(
                        modifier = Modifier.weight(1f),
                        enabled = !loading,
                        onClick = ::createDocument
                    ) {
                        Text("New content")
                    }
                    OutlinedButton(
                        modifier = Modifier.weight(1f),
                        enabled = !loading,
                        onClick = {
                            runTask {
                                refreshCms()
                            }
                        }
                    ) {
                        Text("Refresh")
                    }
                }
            }

            if (editingId.isNotBlank()) {
                item {
                    GlassPanel(Modifier.fillMaxWidth()) {
                        Column(
                            modifier = Modifier.padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            Text(
                                if (editingId == "new") {
                                    "Create CMS content"
                                } else {
                                    "Edit CMS content"
                                },
                                style = MaterialTheme.typography.titleLarge,
                                fontWeight = FontWeight.Black
                            )

                            OutlinedTextField(
                                value = title,
                                onValueChange = { next ->
                                    val previousAutoSlug =
                                        cmsSlugify(title)
                                    title = next
                                    if (
                                        editingId == "new" &&
                                        (slug.isBlank() ||
                                            slug == previousAutoSlug)
                                    ) {
                                        slug = cmsSlugify(next)
                                    }
                                },
                                modifier = Modifier.fillMaxWidth(),
                                label = { Text("Title") },
                                singleLine = true,
                                colors = nexoraOutlinedFieldColors()
                            )

                            OutlinedTextField(
                                value = slug,
                                onValueChange = {
                                    slug = cmsSlugify(it)
                                },
                                modifier = Modifier.fillMaxWidth(),
                                label = { Text("URL slug") },
                                singleLine = true,
                                colors = nexoraOutlinedFieldColors()
                            )

                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .horizontalScroll(
                                        rememberScrollState()
                                    ),
                                horizontalArrangement =
                                    Arrangement.spacedBy(6.dp)
                            ) {
                                listOf(
                                    "pages",
                                    "products",
                                    "blog",
                                    "services",
                                    "testimonials",
                                    "faqs",
                                    "navigation",
                                    "settings"
                                ).forEach { value ->
                                    FilterChip(
                                        selected =
                                            collection == value,
                                        onClick = {
                                            collection = value
                                        },
                                        label = {
                                            Text(value)
                                        }
                                    )
                                }
                            }

                            OutlinedTextField(
                                value = contentJson,
                                onValueChange = {
                                    contentJson = it
                                },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .heightIn(
                                        min = 170.dp,
                                        max = 320.dp
                                    ),
                                label = {
                                    Text("Content (JSON)")
                                },
                                minLines = 7,
                                maxLines = 14,
                                textStyle = MaterialTheme.typography
                                    .bodySmall.copy(
                                        fontFamily =
                                            FontFamily.Monospace
                                    ),
                                colors = nexoraOutlinedFieldColors()
                            )

                            Text(
                                "Status: $documentStatus",
                                color = MaterialTheme.colorScheme.secondary
                            )

                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement =
                                    Arrangement.spacedBy(8.dp)
                            ) {
                                Button(
                                    modifier = Modifier.weight(1f),
                                    enabled = !loading,
                                    onClick = {
                                        val safeTitle = title.trim()
                                        val safeSlug = slug.trim()
                                        val parsedContent = runCatching {
                                            JSONObject(contentJson)
                                        }.getOrElse {
                                            errorText =
                                                "Content must be a valid JSON object."
                                            return@Button
                                        }

                                        if (
                                            safeTitle.isBlank() ||
                                            safeSlug.isBlank()
                                        ) {
                                            errorText =
                                                "Title and slug are required."
                                            return@Button
                                        }

                                        runTask("CMS content saved.") {
                                            if (editingId == "new") {
                                                NexoraApi.createCmsDocument(
                                                    token(),
                                                    installationId,
                                                    email(),
                                                    project.id,
                                                    collection,
                                                    safeSlug,
                                                    safeTitle,
                                                    parsedContent
                                                )
                                            } else {
                                                NexoraApi.updateCmsDocument(
                                                    token(),
                                                    installationId,
                                                    email(),
                                                    editingId,
                                                    collection,
                                                    safeSlug,
                                                    safeTitle,
                                                    parsedContent
                                                )
                                            }
                                            editingId = ""
                                            refreshCms()
                                        }
                                    }
                                ) {
                                    Text("Save")
                                }

                                OutlinedButton(
                                    modifier = Modifier.weight(1f),
                                    onClick = {
                                        editingId = ""
                                        deleteConfirmId = ""
                                    }
                                ) {
                                    Text("Cancel")
                                }
                            }

                            if (editingId != "new") {
                                OutlinedButton(
                                    modifier = Modifier.fillMaxWidth(),
                                    enabled = !loading,
                                    onClick = {
                                        val publish =
                                            documentStatus != "published"
                                        runTask(
                                            if (publish) {
                                                "Content published."
                                            } else {
                                                "Content moved to draft."
                                            }
                                        ) {
                                            NexoraApi
                                                .setCmsDocumentPublished(
                                                    token(),
                                                    installationId,
                                                    email(),
                                                    editingId,
                                                    publish
                                                )
                                            editingId = ""
                                            refreshCms()
                                        }
                                    }
                                ) {
                                    Text(
                                        if (
                                            documentStatus ==
                                            "published"
                                        ) {
                                            "Move to draft"
                                        } else {
                                            "Publish content"
                                        }
                                    )
                                }

                                if (deleteConfirmId == editingId) {
                                    Button(
                                        modifier = Modifier.fillMaxWidth(),
                                        enabled = !loading,
                                        colors = ButtonDefaults.buttonColors(
                                            containerColor =
                                                MaterialTheme.colorScheme.error
                                        ),
                                        onClick = {
                                            val documentId = editingId
                                            runTask("CMS content deleted.") {
                                                NexoraApi.deleteCmsDocument(
                                                    token(),
                                                    installationId,
                                                    email(),
                                                    documentId
                                                )
                                                editingId = ""
                                                deleteConfirmId = ""
                                                refreshCms()
                                            }
                                        }
                                    ) {
                                        Text("Confirm delete")
                                    }
                                } else {
                                    TextButton(
                                        onClick = {
                                            deleteConfirmId = editingId
                                        }
                                    ) {
                                        Text(
                                            "Delete content",
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

            if (editingId.isBlank()) {
                val documents = workspace?.documents.orEmpty()

                if (documents.isEmpty()) {
                    item {
                        Text(
                            "No CMS content yet.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                items(documents, key = { it.id }) { document ->
                    GlassPanel(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                editDocument(document)
                            }
                    ) {
                        Column(
                            modifier = Modifier.padding(15.dp),
                            verticalArrangement =
                                Arrangement.spacedBy(4.dp)
                        ) {
                            Text(
                                document.title,
                                style = MaterialTheme.typography.titleLarge,
                                fontWeight = FontWeight.Black,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                            Text(
                                "${document.collection} · /${document.slug}",
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Text(
                                document.status,
                                color = if (
                                    document.status == "published"
                                ) {
                                    MaterialTheme.colorScheme.primary
                                } else {
                                    MaterialTheme.colorScheme.secondary
                                }
                            )
                        }
                    }
                }
            }
        }
    }
}
