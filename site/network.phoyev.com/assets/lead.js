// Posts every <form data-lead="source"> to /api/lead and shows the page's own confirmation element.
// Fields are read by name; the build step names the Stitch inputs. Honeypot input is "hp".
(function () {
  function note(form, text) {
    let el = form.nextElementSibling
    if (!el || el.dataset.leadNote !== '1') {
      el = document.createElement('p')
      el.dataset.leadNote = '1'
      el.setAttribute('role', 'alert')
      el.className = 'mt-2 text-sm text-red-600'
      form.insertAdjacentElement('afterend', el)
    }
    el.textContent = text
  }

  async function submit(event) {
    event.preventDefault()
    const form = event.currentTarget
    const button = form.querySelector('button[type="submit"]')
    const original = button ? Array.from(button.childNodes, (node) => node.cloneNode(true)) : []
    const payload = { source: form.dataset.lead }
    new FormData(form).forEach((value, key) => {
      if (typeof value === 'string') payload[key] = value
    })
    if (button) button.disabled = true
    try {
      const response = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Something went wrong, please try again')
      const done = form.dataset.success ? document.getElementById(form.dataset.success) : null
      if (done) {
        done.classList.remove('hidden')
        form.classList.add('opacity-40', 'pointer-events-none')
        if (button) button.classList.add('hidden')
        done.scrollIntoView({ behavior: 'smooth', block: 'center' })
      } else if (button) {
        button.textContent = form.dataset.doneText || 'Joined'
        button.disabled = true
      }
    } catch (error) {
      if (button) {
        button.disabled = false
        button.replaceChildren(...original)
      }
      note(form, error.message)
    }
  }

  document.querySelectorAll('form[data-lead]').forEach((form) => form.addEventListener('submit', submit))
})()
