// Edge entry for the static app. Only /p/* reaches this code (see
// wrangler.jsonc run_worker_first); everything else is served from assets.
// Link-preview bots get the server-rendered share card, /p/<slug>/preview.png
// comes from the API, and people get the app.
const API = 'https://mayukhj24-fintrack-api.hf.space'
const BOTS = /(facebookexternalhit|Facebot|WhatsApp\/|LinkedInBot|Slackbot|Slack-ImgProxy|Twitterbot|TelegramBot|Discordbot|SkypeUriPreview|MicrosoftPreview|Pinterestbot|redditbot|Applebot|Googlebot|bingbot|Embedly|Iframely|vkShare|Google-PageRenderer)/

function proxy(url, request) {
  return fetch(url, {
    headers: {
      'user-agent': request.headers.get('user-agent') || '',
      accept: request.headers.get('accept') || '*/*',
    },
  })
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)
    const parts = pathname.split('/').filter(Boolean)
    if (parts[0] === 'p' && parts[1]) {
      const slug = encodeURIComponent(decodeURIComponent(parts[1]))
      if (parts.length === 3 && parts[2] === 'preview.png') {
        return proxy(`${API}/api/public/pages/${slug}/og.png`, request)
      }
      if (parts.length === 2 && BOTS.test(request.headers.get('user-agent') || '')) {
        return proxy(`${API}/api/public/pages/${slug}/share`, request)
      }
    }
    return env.ASSETS.fetch(request)
  },
}
