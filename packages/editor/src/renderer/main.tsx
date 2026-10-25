import './project/api';
import '../bundled-editor';
// Pixi must not use eval/new Function: the editor's Content-Security-Policy forbids it.
import 'pixi.js/unsafe-eval';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { startPlugins } from './plugins/setup';

startPlugins();

createRoot(document.getElementById('root')!).render(<App />);
