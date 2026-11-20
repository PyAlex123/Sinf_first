import { mount } from 'svelte';
import App from './App.svelte';
import { i18n } from './lib/i18n/index.svelte.js';
import { router } from './lib/router.svelte.js';
import { routes } from './routes.js';
import './styles/base.css';

document.documentElement.lang = i18n.locale;
router.start(routes);

const target = document.getElementById('app');
if (!target) {
  throw new Error('#app not found');
}
mount(App, { target });
