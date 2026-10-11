// Minimal probe: run the fixture page on its own, wait 3s, dump state + probe.
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { chromium } from 'playwright'
import { buildDemoHtml } from './test-source-state-browser.mjs'  // not exported; skip
