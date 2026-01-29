11:46:33 AM: build-image version: 78d0fcff90a66ed4048cfb3252450561538f796a (noble-new-builds)
11:46:33 AM: buildbot version: 56e11047b8d1bc23ddae3b2bf8c5bdf7faa6a220
11:46:33 AM: Building without cache
11:46:33 AM: Starting to prepare the repo for build
11:46:33 AM: Preparing Git Reference refs/heads/main
11:46:34 AM: Starting to install dependencies
11:46:34 AM: mise ~/.config/mise/config.toml tools: python@3.14.2
11:46:34 AM: mise ~/.config/mise/config.toml tools: ruby@3.4.8
11:46:35 AM: mise ~/.config/mise/config.toml tools: go@1.25.6
11:46:35 AM: v22.22.0 is already installed.
11:46:35 AM: Now using node v22.22.0 (npm v10.9.4)
11:46:35 AM: Enabling Node.js Corepack
11:46:36 AM: No npm workspaces detected
11:46:36 AM: Installing npm packages using npm version 10.9.4
11:46:36 AM: up to date in 655ms
11:46:36 AM: npm packages installed
11:46:36 AM: Successfully installed dependencies
11:46:37 AM: Detected 1 framework(s)
11:46:37 AM: "vite" at version "5.4.21"
11:46:37 AM: Starting build script
11:46:38 AM: Section completed: initializing
11:46:40 AM: ​
11:46:40 AM: Netlify Build                                                 
11:46:40 AM: ────────────────────────────────────────────────────────────────
11:46:40 AM: ​
11:46:40 AM: ❯ Version
11:46:40 AM:   @netlify/build 35.5.13
11:46:40 AM: ​
11:46:40 AM: ❯ Flags
11:46:40 AM:   accountId: 6966065872bd54583b746e0e
11:46:40 AM:   baseRelDir: true
11:46:40 AM:   buildId: 697b3a876928df000825d32f
11:46:40 AM:   deployId: 697b3a876928df000825d331
11:46:40 AM: ​
11:46:40 AM: ❯ Current directory
11:46:40 AM:   /opt/build/repo
11:46:40 AM: ​
11:46:40 AM: ❯ Config file
11:46:40 AM:   /opt/build/repo/netlify.toml
11:46:40 AM: ​
11:46:40 AM: ❯ Context
11:46:40 AM:   production
11:46:40 AM: ​
11:46:40 AM: build.command from netlify.toml                               
11:46:40 AM: ────────────────────────────────────────────────────────────────
11:46:40 AM: ​
11:46:40 AM: $ npm run build
11:46:40 AM: > m3-connect@1.0.0 build
11:46:40 AM: > tsc && vite build
11:46:42 AM: Failed during stage 'building site': Build script returned non-zero exit code: 2 (https://ntl.fyi/exit-code-2)
11:46:42 AM: src/contexts/AuthContext.tsx(142,3): error TS1443: Module declaration names may only use ' or " quoted strings.
src/contexts/AuthContext.tsx(149,16): error TS1005: ';' expected.
11:46:42 AM: src/contexts/AuthContext.tsx(156,1): error TS1010: '*/' expected.
11:46:42 AM: ​
11:46:42 AM: "build.command" failed                                        
11:46:42 AM: ────────────────────────────────────────────────────────────────
11:46:42 AM: ​
11:46:42 AM:   Error message
11:46:42 AM:   Command failed with exit code 2: npm run build (https://ntl.fyi/exit-code-2)
11:46:42 AM: ​
11:46:42 AM:   Error location
11:46:42 AM:   In build.command from netlify.toml:
11:46:42 AM:   npm run build
11:46:42 AM: ​
11:46:42 AM:   Resolved config
11:46:42 AM:   build:
11:46:42 AM:     command: npm run build
11:46:42 AM:     commandOrigin: config
11:46:42 AM:     environment:
11:46:42 AM:       - VITE_SUPABASE_ANON_KEY
11:46:42 AM:       - VITE_SUPABASE_URL
11:46:42 AM:     publish: /opt/build/repo/dist
11:46:42 AM:     publishOrigin: config
11:46:42 AM:   headers:
11:46:42 AM:     - for: /index.html
11:46:42 AM:       values:
11:46:42 AM:         Cache-Control: no-cache, no-store, must-revalidate
11:46:42 AM:     - for: /*.html
      values:
        Cache-Control: no-cache, no-store, must-revalidate
    - for: /assets/*
      values:
        Cache-Control: public, max-age=31536000, immutable
  headersOrigin: config
  redirects:
    - from: /*
      status: 200
      to: /index.html
  redirectsOrigin: config
11:46:42 AM: Build failed due to a user error: Build script returned non-zero exit code: 2
11:46:42 AM: Failing build: Failed to build site
11:46:42 AM: Finished processing build request in 9.542s
