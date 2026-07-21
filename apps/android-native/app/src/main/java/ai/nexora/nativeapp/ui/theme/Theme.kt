package ai.nexora.nativeapp.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val NexoraDark = darkColorScheme(
    primary = Color(0xFF53D7FF),
    secondary = Color(0xFFA98BFF),
    background = Color(0xFF030617),
    surface = Color(0xFF0A1024),
    surfaceVariant = Color(0xFF121B38),
    onPrimary = Color(0xFF00131A),
    onBackground = Color(0xFFF5F7FF),
    onSurface = Color(0xFFF5F7FF)
)

@Composable
fun NexoraTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = NexoraDark,
        typography = MaterialTheme.typography,
        content = content
    )
}
