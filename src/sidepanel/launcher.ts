async function openSidePanel() {
  try {
    if (!chrome?.tabs?.query || !chrome?.sidePanel?.open) {
      window.close();
      return;
    }

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (tab?.id) {
      await chrome.sidePanel.open({
        tabId: tab.id,
      });
    }
  } finally {
    window.close();
  }
}

void openSidePanel();
