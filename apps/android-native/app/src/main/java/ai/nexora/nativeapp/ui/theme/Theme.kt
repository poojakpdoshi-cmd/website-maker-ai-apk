package ai.nexora.nativeapp.ui.theme

import androidx.compose.foundation.text.selection.LocalTextSelectionColors
import androidx.compose.foundation.text.selection.TextSelectionColors
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

private val NexoraNight = darkColorScheme(
    primary = Color(0xFF63E9FF),
    onPrimary = Color(0xFF001318),
    primaryContainer = Color(0xFF0B3547),
    onPrimaryContainer = Color(0xFFDAF8FF),
    inversePrimary = Color(0xFF00687A),

    secondary = Color(0xFFB69CFF),
    onSecondary = Color(0xFF25005E),
    secondaryContainer = Color(0xFF3B2472),
    onSecondaryContainer = Color(0xFFE9E0FF),

    tertiary = Color(0xFFFF82DD),
    onTertiary = Color(0xFF430037),
    tertiaryContainer = Color(0xFF641151),
    onTertiaryContainer = Color(0xFFFFD8F2),

    background = Color(0xFF03050D),
    onBackground = Color(0xFFF5F7FF),
    surface = Color(0xFF090D19),
    onSurface = Color(0xFFF5F7FF),
    surfaceVariant = Color(0xFF171D30),
    onSurfaceVariant = Color(0xFFD6DCEF),
    surfaceTint = Color(0xFF63E9FF),

    inverseSurface = Color(0xFFE5E8F5),
    inverseOnSurface = Color(0xFF151823),
    outline = Color(0xFF8C98BA),
    outlineVariant = Color(0xFF343E5E),
    scrim = Color(0xFF000000),

    error = Color(0xFFFF8A9D),
    onError = Color(0xFF570014),
    errorContainer = Color(0xFF7A1830),
    onErrorContainer = Color(0xFFFFD9DE)
)

private val NexoraTypography = Typography(
    displaySmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Black,
        fontSize = 36.sp,
        lineHeight = 42.sp,
        letterSpacing = (-0.8f).sp
    ),
    headlineSmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.ExtraBold,
        fontSize = 24.sp,
        lineHeight = 30.sp,
        letterSpacing = (-0.3f).sp
    ),
    titleLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Bold,
        fontSize = 20.sp,
        lineHeight = 26.sp
    ),
    titleMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 16.sp,
        lineHeight = 22.sp
    ),
    bodyLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 16.sp,
        lineHeight = 24.sp
    ),
    bodyMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 14.sp,
        lineHeight = 21.sp
    ),
    bodySmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 12.sp,
        lineHeight = 17.sp
    ),
    labelLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Bold,
        fontSize = 14.sp,
        lineHeight = 20.sp
    ),
    labelMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 12.sp,
        lineHeight = 17.sp
    ),
    labelSmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 11.sp,
        lineHeight = 15.sp
    )
)

@Composable
fun NexoraTheme(content: @Composable () -> Unit) {
    val selectionColors = TextSelectionColors(
        handleColor = NexoraNight.primary,
        backgroundColor = NexoraNight.primary.copy(alpha = 0.28f)
    )

    CompositionLocalProvider(
        LocalTextSelectionColors provides selectionColors
    ) {
        MaterialTheme(
            colorScheme = NexoraNight,
            typography = NexoraTypography,
            content = content
        )
    }
}
