
class WindowSessionDataManager {
    constructor(window, dataKey, loadedCallback, valueTest) {
        if (!valueTest || typeof valueTest !== 'function') {
            valueTest = (value) => value;
        }
        let defaultValue = valueTest();

        var getWindowValue = async () => {
            window = await window;
            let rawValue = await browser.sessions.getWindowValue(window.id, dataKey);
            return valueTest(rawValue);
        };
        var loadedValue = getWindowValue();
        var valueChanged = false;
        var currentValue = loadedValue;
        loadedValue.then((value) => {
            if (value && !valueChanged) {
                if (loadedCallback && typeof loadedCallback === 'function') {
                    loadedCallback(value);
                }
            }
        });
        let valueUpdater = new RequestManager(
            async (value) => {
                value = valueTest(value);
                currentValue = await currentValue;
                if (deepCopyCompare(currentValue, value)) {
                    return;
                }

                window = await window;
                if (!deepCopyCompare(value, defaultValue)) {
                    await browser.sessions.setWindowValue(window.id, dataKey, value);
                } else {
                    await browser.sessions.removeWindowValue(window.id, dataKey);
                }

                await browser.runtime.sendMessage({ type: messageTypes.windowDataChange, windowId: window.id, key: dataKey, newValue: value });

                currentValue = value;
            },
            200,
            false,
        );

        this.updater = valueUpdater;

        var lastValue = currentValue;
        defineProperty(this, 'value', async () => deepCopy(await currentValue), (value) => {
            valueChanged = true;
            value = deepCopy(value);
            lastValue = value;
            valueUpdater.invalidate(value);
        });
        defineProperty(this, 'lastValue', async () => deepCopy(await lastValue));
    }
}



async function initiatePage() {
    let settings = Settings.get(new Settings());
    let window = browser.windows.getCurrent();


    // #region Window Name

    let nameArea = document.createElement('div');
    nameArea.classList.add('windowNameArea');
    nameArea.classList.add('area');
    nameArea.classList.add('noMargin');
    document.body.appendChild(nameArea);

    let nameLabel = document.createElement('label');
    nameLabel.classList.add('windowNameLabel');
    nameLabel.classList.add(messagePrefix + 'popup_WindowName');
    nameArea.appendChild(nameLabel);

    let windowName = document.createElement('input');
    windowName.id = 'windowName';
    windowName.type = 'text';
    nameArea.appendChild(windowName);


    let nameDataManager = new WindowSessionDataManager(
        window,
        windowDataKeys.name,
        (value) => {
            windowName.value = value;
        },
        (value) => {
            if (!value) {
                return '';
            }
            return value;
        }
    );


    new EventListener(windowName, 'input', (e) => {
        nameDataManager.value = windowName.value;
    });
    new EventListener(windowName, 'keypress', (e) => {
        if (e.key === "Enter") {
            nameDataManager.updater.unblock();
        }
    });

    // #endregion Window Name


    // #region Name Placeholders

    {
        let formatPlaceholderSection = createCollapsableArea();
        formatPlaceholderSection.content.classList.add('standardFormat');
        formatPlaceholderSection.content.classList.add('textSelectable');
        formatPlaceholderSection.area.classList.add('noShadow');
        formatPlaceholderSection.area.classList.add('formatSection');
        formatPlaceholderSection.title.classList.add('small');
        formatPlaceholderSection.title.classList.add('center');
        document.body.appendChild(formatPlaceholderSection.area);

        let header = document.createElement('div');
        header.classList.add(messagePrefix + 'popup_FormatPlaceholders');
        formatPlaceholderSection.title.appendChild(header);

        let formatPlaceholderArea = document.createElement('div');
        formatPlaceholderArea.classList.add('formatInfo');
        formatPlaceholderSection.content.appendChild(formatPlaceholderArea);

        let isFirst = true;
        for (let placeholder of FormatPlaceholder.all) {
            if (placeholder === formatPlaceholders.windowName) {
                continue;
            }
            if (!isFirst) {
                formatPlaceholderArea.appendChild(document.createElement('br'));
                formatPlaceholderArea.appendChild(document.createElement('br'));
            }
            let area = document.createElement('label');
            area.textContent = placeholder.messageText;
            formatPlaceholderArea.appendChild(area);
            isFirst = false;
        }
    }

    // #endregion Name Placeholders


    // #region Setting overrides

    {
        let onLoadedSettings = new EventManager();
        let settingDataManager = new WindowSessionDataManager(
            window,
            windowDataKeys.settings,
            (value) => {
                onLoadedSettings.fire(value);
            },
            (value) => {
                if (!value) {
                    value = {};
                }
                let defaultValues = {
                    windowPrefixFormat: '',
                };
                for (let key of Object.keys(defaultValues)) {
                    if (!value[key]) {
                        value[key] = {};
                    }
                    let overrideSetting = value[key];
                    if (!overrideSetting.value) {
                        overrideSetting.value = defaultValues[key];
                    }
                    if (defaultValues[key] === Boolean(defaultValues[key])) {
                        overrideSetting.value = Boolean(overrideSetting.value);
                    }
                    overrideSetting.override = Boolean(overrideSetting.override);
                }
                return value;
            }
        );

        let settingArea = createCollapsableArea();
        settingArea.title.classList.add('small');
        settingArea.area.classList.add('noShadow');
        settingArea.area.classList.add('settingArea');
        settingArea.title.classList.add('center');
        document.body.appendChild(settingArea.area);

        settingArea.title.classList.add('enablable');
        settingArea.content.classList.add('standardFormat');

        let settingTitle = document.createElement('div');
        settingTitle.classList.add('settingTitle');
        settingTitle.classList.add(messagePrefix + 'popup_SettingsTitle');
        settingArea.title.appendChild(settingTitle);

        let settingOverrides = [];
        let checkIfAnyOverrideSetting = () => {
            toggleClass(settingArea.title, 'enabled', settingOverrides.filter(obj => obj.override).length > 0);
        };

        let createOverrideSetting = (settingKey) => {
            let currentValue;
            let onChange = new EventManager();
            var change = async () => {
                let latest = await settingDataManager.lastValue;
                let settingKeyData = latest[settingKey];
                settingKeyData.override = overrideObj.checkbox.checked;
                settingKeyData.value = currentValue;
                settingDataManager.value = latest;
            };

            let area = document.createElement('div');
            area.classList.add('area');
            area.classList.add('noMargin');
            area.classList.add('noPadding');

            let overrideObj = createCheckBox(null, 'popup_SettingsOverride');
            overrideObj.area.classList.add('overrideArea');
            area.appendChild(overrideObj.area);

            overrideObj.checkbox.addEventListener('input', (e) => {
                change();
                checkIfAnyOverrideSetting();
            });

            let contentArea = document.createElement('div');
            contentArea.classList.add('overrideSettingArea');
            area.appendChild(contentArea);

            let setValue = (value, internal = false) => {
                if (value === currentValue) {
                    return;
                }
                currentValue = value;

                if (internal) {
                    onChange.fire(value);
                } else {
                    change();
                }
            };

            onLoadedSettings.addListener((settingsData) => {
                if (settingsData && settingsData[settingKey]) {
                    let dataManager = settingsData[settingKey];
                    overrideObj.checkbox.checked = dataManager.override;
                    setValue(dataManager.value, true);

                    checkIfAnyOverrideSetting();
                }
            });


            var obj = {
                area: area,
                content: contentArea,

                onChange: onChange.subscriber,
            };
            defineProperty(obj, 'value', () => deepCopy(currentValue), (value) => setValue(value));
            defineProperty(obj, 'override', () => overrideObj.checkbox.checked);


            settingArea.content.appendChild(area);
            settingOverrides.push(obj);
            return obj;
        };

        {
            let defaultName = createOverrideSetting('windowPrefixFormat');

            let info = document.createElement('div');
            info.classList.add(messagePrefix + 'options_Format');
            defaultName.content.appendChild(info);

            let defaultNameInput = document.createElement('input');
            defaultNameInput.type = 'text';
            defaultName.content.appendChild(defaultNameInput);

            defaultNameInput.addEventListener('input', (e) => {
                defaultName.value = defaultNameInput.value;
            });
            defaultName.onChange.addListener((value) => {
                defaultNameInput.value = value;
            });
        }

    }

    // #endregion Setting overrides

    setTextMessages();
    settings = await settings;
}


initiatePage();
