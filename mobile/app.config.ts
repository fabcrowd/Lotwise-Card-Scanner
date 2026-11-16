import type { ExpoConfig } from 'expo/config';

const CAMERA_REASON = 'The camera takes the photo of the card you want to scan. Photos stay on this device.';
const PHOTOS_REASON = 'Lets you pick a saved photo of cards to scan. Photos stay on this device.';

const config: ExpoConfig = {
  name: 'Sweep',
  slug: 'sweep',
  version: '0.1.0',
  scheme: 'sweep',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: 'com.fabcrowd.sweep',
    supportsTablet: true,
    infoPlist: {
      NSCameraUsageDescription: CAMERA_REASON,
      NSPhotoLibraryUsageDescription: PHOTOS_REASON,
    },
  },
  android: {
    package: 'com.fabcrowd.sweep',
    permissions: ['android.permission.CAMERA'],
    blockedPermissions: ['android.permission.RECORD_AUDIO'],
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
  },
  plugins: [
    'expo-router',
    ['expo-camera', { cameraPermission: CAMERA_REASON, recordAudioAndroid: false }],
    // The app records no sound. The picker's camera option stays on: turning it off also removes Android's CAMERA permission.
    ['expo-image-picker', { photosPermission: PHOTOS_REASON, microphonePermission: false }],
    'expo-secure-store',
    'expo-sharing',
    'expo-image',
    // Links the native ONNX runtime that runs the same model files as the extension.
    'onnxruntime-react-native',
  ],
  experiments: { typedRoutes: true },
};

export default config;
