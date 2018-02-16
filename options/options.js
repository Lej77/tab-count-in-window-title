

async function initiatePage() {
    let settings = Settings.get(new Settings());
    setTextMessages();
    settings = await settings;

    for (let key of Object.keys(settings)) {
        let element = document.getElementById(key);
        if (!element)
            continue;
        element.value = settings[key];
        element.addEventListener("input", e => {
            Settings.set(key, e.target.value);
        });
    }

    let _isUpdating = false;
    let manager = {
        get isUpdating() {
            return Boolean(_isUpdating);
        },
        set isUpdating(value) {
            value = Boolean(value);
            _isUpdating = value;

            if (value) {
                document.documentElement.classList.add("updating");
            } else {
                document.documentElement.classList.remove("updating");
                browser.runtime.sendMessage({type: "clearPrefix"});
            }

            Settings.set("isEnabled", value);
        },
    }
    if (settings.isEnabled) {
        manager.isUpdating = true;
    }
    

    document.getElementById("options_StopUpdates").addEventListener("click", e => {
        manager.isUpdating = false;
    });
    document.getElementById("options_StartUpdates").addEventListener("click", e => {
        manager.isUpdating = true;
    });
}


function setTextMessages() {
    let elementsWithText = document.getElementsByClassName("message");
    for (let i = 0; i < elementsWithText.length; i++) {
        let ele = elementsWithText[i];
        if (ele.id) {
            ele.textContent = browser.i18n.getMessage(ele.id);
        }
    }
}


initiatePage();

