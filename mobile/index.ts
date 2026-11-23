// The platform adapters must exist before any extension module runs, so they are installed before the router loads.
import './src/platform/native';
import 'expo-router/entry';
