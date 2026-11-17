// Public page links: link-preview bots get the server-rendered share card,
// /p/<slug>/preview.png comes from the API, everyone else gets the app.
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

export async function onRequest(context) {
  const { request, params, next } = context
  const parts = Array.isArray(params.path) ? params.path : []
  const slug = parts[0] ? encodeURIComponent(parts[0]) : ''

  if (slug && parts.length === 2 && parts[1] === 'preview.png') {
    return proxy(`${API}/api/public/pages/${slug}/og.png`, request)
  }
  if (slug && parts.length === 1 && BOTS.test(request.headers.get('user-agent') || '')) {
    return proxy(`${API}/api/public/pages/${slug}/share`, request)
  }
  return next()
}
