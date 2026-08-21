plugins {
    id("com.android.application")
}

android {
    namespace = "vn.giatoc.namehub"
    compileSdk = 36

    defaultConfig {
        applicationId = "vn.giatoc.namehub"
        minSdk = 26
        targetSdk = 36
        versionCode = 11000
        versionName = "1.10.0-native"
        buildConfigField("String", "HUB_BASE_URL", "\"https://giatocnamehub.up.railway.app\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
