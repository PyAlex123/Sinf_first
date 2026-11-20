import { mount } from 'svelte';
import { i18n } from '../lib/i18n/index.svelte.js';
import '../styles/base.css';
import DemoApp from './DemoApp.svelte';

document.documentElement.lang = i18n.locale;

const target = document.getElementById('app');
if (!target) {
  throw new Error('#app not found');
}
mount(DemoApp, { target });
