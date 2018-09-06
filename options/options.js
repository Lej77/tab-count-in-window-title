
async function initiatePage() {
    let settingsTracker = new SettingsTracker();
    let settings = settingsTracker.settings;

    var pagePort = new PortConnection();
    var sectionAnimation = { standard: false }; // No animation before load to expand initial sections immediately.

    // #region Delayed Listener Startup

    var eventStarters = new DisposableCreators();
    var startListener = (callback) => eventStarters.createDisposable(callback);
    var startAllListeners = () => eventStarters.start();

    // #endregion Delayed Listener Startup


    // #region Window Title

    {
        let winTitleSection = createCollapsableArea(sectionAnimation);
        winTitleSection.isCollapsed = false;
        winTitleSection.area.classList.add('standardFormat');
        winTitleSection.title.classList.add('center');
        document.body.appendChild(winTitleSection.area);

        let header = document.createElement('div');
        header.classList.add(messagePrefix + 'options_GeneralSection_Header');
        winTitleSection.title.appendChild(header);

        winTitleSection.content.appendChild(document.getElementById('generalSettingsArea'));
    }

    // #endregion Window Title

    // #region Format Placeholders

    {
        let formatPlaceholderArea = document.getElementById('formatPlaceholders');
        for (let placeholder of FormatPlaceholder.all) {
            let area = document.createElement('div');
            area.textContent = placeholder.messageText;
            formatPlaceholderArea.appendChild(area);
        }
    }

    // #endregion Format Placeholders


    // #region Stop & Start Button

    {
        let _isUpdating = false;
        let manager = {
            get isUpdating() {
                return Boolean(_isUpdating);
            },
            set isUpdating(value) {
                value = Boolean(value);
                let oldValue = _isUpdating;
                _isUpdating = value;

                if (value) {
                    document.documentElement.classList.add("updating");
                    if (oldValue) {
                        browser.runtime.sendMessage({ type: messageTypes.updatePrefix });
                    }
                } else {
                    document.documentElement.classList.remove("updating");
                    browser.runtime.sendMessage({ type: messageTypes.clearPrefix });
                }

                Settings.set("isEnabled", value);
            },
        };

        startListener(() => {
            if (settings.isEnabled) {
                manager.isUpdating = true;
            }
        });


        document.getElementById("stopUpdates").addEventListener("click", e => {
            manager.isUpdating = false;
        });
        document.getElementById("startUpdates").addEventListener("click", e => {
            manager.isUpdating = true;
        });
    }

    // #endregion Stop & Start Button


    // #region Window Data

    {
        let winDataSection = createCollapsableArea(sectionAnimation);
        winDataSection.isCollapsed = false;
        winDataSection.area.classList.add('standardFormat');
        winDataSection.title.classList.add('center');
        document.body.appendChild(winDataSection.area);

        let header = document.createElement('div');
        header.classList.add(messagePrefix + 'options_WindowData_Header');
        winDataSection.title.appendChild(header);

        winDataSection.content.appendChild(document.getElementById('windowDataArea'));

        document.getElementById('clearWindowDataButton').addEventListener('click', () => {
            let ok = confirm(browser.i18n.getMessage('options_WindowData_ClearData_Warning'));
            if (ok) {
                browser.runtime.sendMessage({ type: messageTypes.clearWindowData });
            }
        });
        document.getElementById('applyDefaultWindowNameButton').addEventListener('click', () => {
            let ok = confirm(browser.i18n.getMessage('options_WindowData_ApplyDefaultName_Warning'));
            if (ok) {
                browser.runtime.sendMessage({ type: messageTypes.applyWindowName, name: document.getElementById('windowDefaultName').value });
            }
        });
    }

    // #endregion Window Data



    // #region Commands

    {
        let section = createCollapsableArea(sectionAnimation);
        section.area.classList.add('standardFormat');
        section.title.classList.add('center');
        section.title.classList.add('enablable');
        document.body.appendChild(section.area);

        let header = document.createElement('div');
        header.classList.add(messagePrefix + 'options_Commands_Title');
        section.title.appendChild(header);

        section.content.classList.add('commandsContentArea');


        let information = document.createElement('div');
        information.classList.add(messagePrefix + 'options_Commands_Info');
        section.content.appendChild(information);


        section.content.appendChild(document.createElement('br'));


        let commandsArea = document.createElement('div');
        commandsArea.classList.add('commandsArea');
        section.content.appendChild(commandsArea);


        var allCommands = [];
        let checkCommands = () => {
            let enabled = allCommands.some(command => command.shortcut);
            toggleClass(section.title, 'enabled', enabled);
        };


        let commandInfos = {
            '_execute_browser_action': {
                description: 'options_Commands_BrowserAction',
                createContent: () => {
                    return null;
                },
            },
        };


        let platformInfo = browser.runtime.getPlatformInfo().then(({ os, arch }) => {
            return {
                isMac: os.toLowerCase() === 'mac',
            };
        });

        // See: https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/manifest.json/commands#Shortcut_values
        const keyLookup = {
            ',': 'Comma',
            '.': 'Period',
            ' ': 'Space',
            // Home, End, PageUp, PageDown, Space, Insert, Delete, Up, Down, Left, Right
        };

        // See: https://developer.mozilla.org/docs/Web/API/KeyboardEvent/getModifierState
        const modifierKeys = {
            alt: 'Alt',
            ctrl: 'Control',
            capsLock: 'CapsLock',
            fn: 'Fn',
            fnLock: 'FnLock',
            hyper: 'Hyper',
            meta: 'Meta',
            numLock: 'NumLock',
            os: 'OS',
            scrollLock: 'ScrollLock',
            shift: 'Shift',
            super: 'Super',
            symbol: 'Symbol',
            symbolLock: 'SymbolLock',
        };

        const fixKey = (key) => {
            key = key.charAt(0).toUpperCase() + key.toString().slice(1);
            if (key.startsWith('Arrow')) {
                key = key.slice(5);
            }
            let fixedKey = keyLookup[key];
            if (fixedKey) {
                key = fixedKey;
            }
            return key;
        };

        const createShortcutArea = async (command) => {
            let { isMac = false } = await platformInfo;
            let commandInfo = commandInfos[command.name] || {};


            let commandSection = createCollapsableArea(sectionAnimation);
            commandSection.area.classList.add('standardFormat');
            commandSection.title.classList.add('stretch');
            commandSection.title.classList.add('enablable');
            commandsArea.appendChild(commandSection.area);

            {
                let contentArea = null;
                if (commandInfo.createContent && typeof commandInfo.createContent === 'function') {
                    contentArea = commandInfo.createContent();
                }
                if (contentArea) {
                    commandSection.content.appendChild(contentArea);
                } else {
                    commandSection.title.classList.add('preventOpen');
                }
            }


            let area = document.createElement('div');
            area.classList.add('commandArea');
            commandSection.title.appendChild(area);

            let inputsArea = document.createElement('div');
            inputsArea.classList.add('inputArea');
            inputsArea.classList.add('preventOpen');
            area.appendChild(inputsArea);

            let resetButton = document.createElement('button');
            resetButton.classList.add(messagePrefix + 'options_Commands_ResetButton');
            inputsArea.appendChild(resetButton);

            let promptButton = document.createElement('button');
            promptButton.classList.add(messagePrefix + 'options_Commands_PromptButton');
            inputsArea.appendChild(promptButton);

            let inputField = document.createElement('input');
            inputField.type = "text";
            inputField.readOnly = true;
            inputsArea.appendChild(inputField);

            let description = document.createElement('label');
            if (commandInfo.description) {
                description.classList.add(messagePrefix + commandInfo.description);
            } else {
                description.textContent = command.name;
            }
            area.appendChild(description);


            inputField.value = command.shortcut;


            const checkCommand = () => {
                toggleClass(commandSection.title, 'enabled', command.shortcut);
            };
            checkCommand();


            const updateShortcut = async () => {
                let [afterUpdate,] = (await browser.commands.getAll()).filter(com => com.name === command.name);
                if (afterUpdate) {
                    Object.assign(command, afterUpdate);
                }
                inputField.value = command.shortcut;

                checkCommand();
                checkCommands();
            };
            eventStarters.createDisposable(() => {
                updateShortcut();
            });

            resetButton.addEventListener('click', async (e) => {
                await browser.commands.reset(command.name);
                updateShortcut();
            });

            promptButton.addEventListener('click', async (e) => {
                const value = prompt(browser.i18n.getMessage('options_Commands_PromptButton_Description'), command.shortcut || '');

                await browser.commands.update({
                    name: command.name,
                    shortcut: value,
                });

                updateShortcut();
            });

            inputField.addEventListener('keydown', async (e) => {
                if (Object.values(modifierKeys).includes(e.key))
                    return;

                let keys = [];
                if (e.ctrlKey) {
                    keys.push(isMac ? 'MacCtrl' : 'Ctrl');
                }
                if (e.altKey) {
                    keys.push('Alt');
                }
                if (e.metaKey) {
                    keys.push('Command');
                }
                if (e.shiftKey) {
                    keys.push('Shift');
                }
                keys.push(fixKey(e.key));

                await browser.commands.update({
                    name: command.name,
                    shortcut: keys.join('+'),
                });

                updateShortcut();
            });
        };


        // Create areas for all commands:
        browser.commands.getAll().then(async (commands) => {
            for (let command of commands) {
                await createShortcutArea(command);
            }

            setTextMessages(section.content);
            allCommands = commands;
            eventStarters.createDisposable(() => {
                checkCommands();
            });

            if (eventStarters.isStarted) {
                eventStarters.stop();
                eventStarters.start();
            }
        });
    }

    // #endregion Commands



    // #region Fix No Title for New Tab Pages

    {
        let fixNoTitleSection = createCollapsableArea(sectionAnimation);
        fixNoTitleSection.title.classList.add('enablable');
        fixNoTitleSection.title.classList.add('center');
        fixNoTitleSection.area.classList.add('standardFormat');
        document.body.appendChild(fixNoTitleSection.area);

        let fixNoTitleHeader = document.createElement('div');
        fixNoTitleHeader.classList.add(messagePrefix + 'options_NewTabNoTitleWorkaround_Header');
        fixNoTitleSection.title.appendChild(fixNoTitleHeader);

        let fixNoTitleArea = document.getElementById('fixNoTabForNewTabPagesArea');
        fixNoTitleSection.content.appendChild(fixNoTitleArea);

        let fixNoTitleCheckbox = document.getElementById('newTabNoTitleWorkaround_Enabled');
        let checkboxChanged = () => {
            let value = fixNoTitleCheckbox.checked;
            toggleClass(fixNoTitleSection.title, 'enabled', value);
            toggleClass(fixNoTitleArea, 'enabled', value);
        };
        let checkPermission = async () => {
            let hasPermissions = await browser.permissions.contains({ permissions: ['tabs'] });
            toggleClass(fixNoTitleSection.title, 'error', !hasPermissions);
        };
        startListener(() => {
            let listener = new EventListener(fixNoTitleCheckbox, 'input', (e) => checkboxChanged());
            checkboxChanged();
            let permissionListener = new EventListener(onPermissionChange, () => checkPermission());
            checkPermission();
            return [listener, permissionListener];
        });
    }

    // #endregion Fix No Title for New Tab Pages


    // #region Optional Permissions
    var onPermissionChange;
    {
        let optionalPermissionsArea = createCollapsableArea(sectionAnimation);
        optionalPermissionsArea.area.classList.add('standardFormat');
        optionalPermissionsArea.title.classList.add('center');
        optionalPermissionsArea.title.classList.add('enablable');
        optionalPermissionsArea.content.classList.add('optionalPermissionArea');
        document.body.appendChild(optionalPermissionsArea.area);

        let permissionControllers = [];
        onPermissionChange = new EventManager();
        onPermissionChange.addListener(() => {
            let hasAnyPermission = permissionControllers.filter(controller => controller.hasPermission).length > 0;
            toggleClass(optionalPermissionsArea.title, 'enabled', hasAnyPermission);
        });
        let pagePermissionChanged = pagePort.getEvent('permissionChanged');


        let areaDetails = {
            requestViaBrowserActionCallback: async (permission) => await pagePort.sendMessageBoundToPort({ type: messageTypes.requestPermission, permission: permission }),
            permissionChangedCallback: (obj, internalChange) => {
                if (internalChange) {
                    browser.runtime.sendMessage({ type: messageTypes.permissionsChanged, permission: obj.permission, value: obj.hasPermission });
                }
                onPermissionChange.fire(obj);
            },
            onPermissionChanged: pagePermissionChanged,
            sectionAnimationInfo: sectionAnimation,
        };

        let createPermissionButtonArea = function (permission, titleMessage, explanationMessage) {
            let obj = createOptionalPermissionArea(Object.assign(areaDetails, { permission, titleMessage, explanationMessage }));
            permissionControllers.push(obj);
            optionalPermissionsArea.content.appendChild(obj.area);
            return obj;
        };

        let header = document.createElement('div');
        header.classList.add(messagePrefix + 'options_OptionalPermissions_Header');
        optionalPermissionsArea.title.appendChild(header);

        createPermissionButtonArea({ permissions: ['tabs'] }, 'options_OptionalPermissions_Tabs_Title', 'options_OptionalPermissions_Tabs_Explanation');
    }

    // #endregion Optional Permissions


    document.body.appendChild(document.getElementById('otherSettings'));


    setTextMessages();
    await settingsTracker.start;
    bindElementIdsToSettings(settings);
    startAllListeners();

    let checkAnimations = () => {
        if (settings.disableOptionsPageAnimations) {
            sectionAnimation.update({ reset: true });
        } else {
            sectionAnimation.update({ standard: true });
        }
    };
    settingsTracker.onChange.addListener((changes) => {
        if (changes.disableOptionsPageAnimations) {
            checkAnimations();
        }
    });
    checkAnimations();
}


initiatePage();

