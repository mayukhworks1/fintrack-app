import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/**
 * A page's Links manager, opened straight on "Access requests" when the URL
 * says ?links=requests (the password-request notification and email link
 * there). Returns [tab, setTab]; call open() when the Links button is pressed.
 */
export function useLinksDeepLink(setOpen) {
  const location = useLocation()
  const navigate = useNavigate()
  const [tab, setTab] = useState('links')

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (params.get('links') !== 'requests') return
    setTab('requests')
    setOpen(true)
    params.delete('links')
    const qs = params.toString()
    navigate({ pathname: location.pathname, search: qs ? `?${qs}` : '' }, { replace: true })
  }, [location.search]) // eslint-disable-line react-hooks/exhaustive-deps

  return [tab, setTab]
}
