
const messagePrefix = 'message_';

async function initiatePage() {
    let settings = Settings.get(new Settings());
    setTextMessages();
    settings = await settings;

    bindElementIdsToSettings(settings);


    // #region Stop & Start Button

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
    };
    if (settings.isEnabled) {
        manager.isUpdating = true;
    }
    

    document.getElementById("stopUpdates").addEventListener("click", e => {
        manager.isUpdating = false;
    });
    document.getElementById("startUpdates").addEventListener("click", e => {
        manager.isUpdating = true;
    });

    // #endregion Stop & Start Button
}


function setTextMessages(elementsToText = null) {
    if (!Array.isArray(elementsToText)) {
        rootElement = document;
        if (elementsToText) {
            rootElement = elementsToText;
        }
        elementsToText = rootElement.querySelectorAll(`*[class*='${messagePrefix}']`);
    }
    for (let i = 0; i < elementsToText.length; i++) {
        let ele = elementsToText[i];
        for (let c of ele.classList) {
            if (c.length > messagePrefix.length && c.startsWith(messagePrefix)) {
                let messageId = c.substring(messagePrefix.length);
                ele.textContent = browser.i18n.getMessage(messageId);
                break;
            }
        }
    }
}


function bindElementIdsToSettings(settings) {
    for (let key of Object.keys(settings)) {
        let element = document.getElementById(key);
        if (!element) {
            continue;
        }

        let propertyName;
        if (element.type === 'checkbox') {
            propertyName = 'checked';
        } else {
            propertyName = 'value';
        }

        element[propertyName] = settings[key];
        element.addEventListener("input", e => {
            Settings.set(key, e.target[propertyName]);
        });
    }
}


initiatePage();

