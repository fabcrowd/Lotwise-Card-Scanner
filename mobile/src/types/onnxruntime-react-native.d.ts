// onnxruntime-react-native 1.24.3 ships its TypeScript source but not the declaration files its package.json
// names. Its public API is onnxruntime-common's, which does ship declarations.
declare module 'onnxruntime-react-native' {
  export * from 'onnxruntime-common';
}
