import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// No StrictMode: it double-mounts effects, which would create two WebGL
// renderers on the same canvas during development.
createRoot(document.getElementById('root')).render(<App />);
