RSA STUDIO (free, runs on your own computer)
=============================================

Eta Claude-er bahire chole. Website nijei pore, AI-er jonno free key use kore.
Kono paid plan lagbe na.

EKBAR SETUP
-----------
1. Node.js install korun: https://nodejs.org (LTS version, 18 ba tar upore).
2. Free AI key nin: https://aistudio.google.com/apikey
   (Google account diye login, "Create API key". Card lagbe na.)
3. start.bat-e double click korun.
   Prothom bar Notepad khulbe. GEMINI_API_KEY= er pore key boshan, Save kore close korun.
4. Browser-e RSA Studio khulbe (http://localhost:3000).

PROTIDIN
--------
start.bat double click korun. Kaj shesh hole black window-e Ctrl+C chapun.

KIVABE BUILD KORBEN
-------------------
- "Landing page links" e site-er link din, budget ar location likhun, "Build account" chapun.
- App nijei website pore (browser khule noy, server theke), tarpor plan, negative list,
  RSA ar asset toiri kore. Sob character limit app nijei count kore.
- Shesh-e "Ads Editor CSV" ba "Build sheet PDF" diye download korun.
- Project auto save hoy (ei browser-e). Pore "Update existing" diye change korte parben.

FREE LIMIT NIYE
---------------
- Free AI-er minute ar dine request limit ache. Ekta full build-e onek call hoy,
  tai app protita call-er majhe 4.5 second thame ar limit khele nijei apekkha kore retry kore.
  Build 5 theke 15 minute nite pare. Eta normal.
- Je "Daily free limit reached" dekhay, tokhon kal abar chalan, ba .env-e PROVIDER onno
  free service-e bodle din (groq / openrouter). Limit bodlay, tai notun number AI Studio-te dekhe niben.
- Groq-er free tier-e ekta request-e token limit choto, boro build-e fail korte pare.
  Gemini-i sobcheye bhalo.
- Privacy: free tier-e pathano text provider product improve-e use korte pare.
  Client-er gopon tothyo (internal rate, contract) website content-e rakhben na.

JS diye load hoy emon site
--------------------------
Je site-er text onek choto ashe, seta JavaScript-e load hoy. Duita upay:
a) Browser-e site khule page-er text copy kore "Website content" box-e paste korun.
b) Ba ekbar ei command chalan (free):
      npm install playwright
      npx playwright install chromium
   Tarpor app nijei sotti browser khule oi site porbe.

OFFLINE (shompurno free, kono key lagbe na)
-------------------------------------------
Ollama (https://ollama.com) install kore ekta model nin (jemon: ollama pull llama3.1),
.env-e PROVIDER=ollama din. PC shokto na hole dhire cholbe ar copy-r man Gemini-r cheye kom hobe.

SAMOSSHA
--------
- "AI key is missing": .env file-e key boshaye app abar chalan.
- "Local server stopped": start.bat abar chalan, page reload korun.
- Port 3000 busy: .env-e PORT=3100 likhun.
- Ad copy-te kono claim (rating, years, price) site-e na thakle app seta "gap" hishebe dekhay.
  Launch-er age "Confirm with the client" list ta mikiye niben.
