
// #region Constants

const messagePrefix = 'message_';

const debug = {
    popop_sessionRestoreTracking: false,
};

const windowDataKeys = Object.freeze({
    name: 'name',
    settings: 'settings',
    isRestored: 'isRestored',
});
const messageTypes = Object.freeze({
    windowDataChange: 'windowDataChange',
    clearPrefix: 'clearPrefix',
    updatePrefix: 'updatePrefix',
    permissionsChanged: 'permissionsChanged',
    requestPermission: 'requestPermission',
    clearWindowData: 'clearWindowData',
    applyWindowName: 'applyWindowName',
});


class FormatPlaceholder {
    constructor(format, message, regExpFlags = "ig") {
        this.format = format;
        this.regExp = new RegExp(format, regExpFlags);
        this.message = message;
        this.messageText = '';
        try {
            this.messageText = browser.i18n.getMessage(message, format);
        } catch (error) {
            console.log('Failed to get format placeholder message', error);
        }
    }

    test(string) {
        if (!string || typeof string !== 'string') {
            return false;
        } else {
            return string.search(this.regExp) >= 0;
        }
    }

    static createFormatInfo(titleFormat) {
        return {
            hasText: titleFormat && titleFormat != '',

            useTabCount: formatPlaceholders.tabCount.test(titleFormat),
            useTotalTabCount: formatPlaceholders.totalTabCount.test(titleFormat),

            useWindowName: formatPlaceholders.windowName.test(titleFormat),
            useCount: formatPlaceholders.count.test(titleFormat),
        };
    }

    static combineFormatInfos(formatInfos) {
        if (!formatInfos) {
            return;
        }
        if (!Array.isArray(formatInfos)) {
            formatInfos = [formatInfos];
        }
        if (formatInfos.length === 0) {
            return [];
        }
        if (formatInfos.length === 1) {
            return formatInfos[0];
        }
        let combined = FormatPlaceholder.createFormatInfo('');
        for (let formatInfo of formatInfos) {
            if (!formatInfo) {
                continue;
            }
            if (typeof formatInfo === 'string') {
                formatInfo = FormatPlaceholder.createFormatInfo(formatInfo);
            }
            if (Array.isArray(formatInfo)) {
                if (formatInfo.length === 0) {
                    continue;
                }
                if (formatInfo.length === 1) {
                    formatInfo = formatInfo[0];
                } else {
                    formatInfo = FormatPlaceholder.combineFormatInfos(formatInfo);
                }
            }
            for (let key of Object.keys(formatInfo)) {
                if (formatInfo[key]) {
                    combined[key] = formatInfo[key];
                }
            }
        }
        return combined;
    }

    static get all() {
        return Object.keys(formatPlaceholders).map(placeholderKey => formatPlaceholders[placeholderKey]);
    }
}

const formatPlaceholders = Object.freeze({
    tabCount: new FormatPlaceholder('%TabCount%', 'options_FormatPlaceholders_TabCount'),                       // Tab count in current window.
    totalTabCount: new FormatPlaceholder('%TotalTabCount%', 'options_FormatPlaceholders_TotalTabCount'),        // Total tab count.

    windowName: new FormatPlaceholder('%WindowName%', 'options_FormatPlaceholders_WindowName'),                 // User defined window name.
    count: new FormatPlaceholder('%Count%', 'options_FormatPlaceholders_Count'),                                // Unique identifier. Starts as 1 and increments untill unique.
});

// #endregion Constants


// #region Utilities

async function delay(timeInMilliseconds) {
    return await new Promise((resolve, reject) => timeInMilliseconds < 0 ? resolve() : setTimeout(resolve, timeInMilliseconds));
}

let createObjectFromKeys = function (
    keys,                   // array of strings.
    values,                 // object, or array of objects.
    defaultValue = null     // object.
) {
    if (keys && Array.isArray(keys)) {
        data = {};
        let valueIsArray = Array.isArray(values);
        for (let i = 0; i < keys.length; i++) {
            if (typeof keys[i] === "string")
                data[keys[i]] = valueIsArray ? (i < values.length ? values[i] : defaultValue) : values;
        }
        return data;
    } else {
        return keys;
    }
};

let defineProperty = (obj, propertyName, get, set) => {
    let getSet = {};
    if (get) {
        getSet.get = get;
    }
    if (set) {
        getSet.set = set;
    }
    Object.defineProperty(obj, propertyName, getSet);
};

let checkAny = (array) => {
    array = array.filter(value => value);
    if (array.length === 0) {
        return false;
    }

    let promiseWrapper = new PromiseWrapper();

    let promises = 0;
    let waitForValue = async (value) => {
        try {
            value = await value;
            if (value) {
                promiseWrapper.resolve(value);
            }
        } finally {
            promises--;

            if (promises <= 0) {
                promiseWrapper.resolve(false);
            }
        }
    };

    promises++;
    for (let value of array) {
        promises++;
        waitForValue(value);
    }
    promises--;

    if (promises <= 0) {
        promiseWrapper.resolve(false);
    }
    return promiseWrapper.getValue();
};

let deepCopy = (value) => {
    if (!value) {
        return value;
    }
    if (typeof value === 'string') {
        return value;
    }
    let jsonCopy = JSON.parse(JSON.stringify(value));
    return jsonCopy;
};

let deepCopyCompare = (a, b) => {
    if (a === b) {
        return true;
    }
    if (!a && !b) {
        return a === b;
    }
    if (!a || !b) {
        return false;
    }
    let aString = typeof a === 'string';
    let bString = typeof b === 'string';
    if (aString && bString) {
        return a === b;
    } else if (aString || bString) {
        return false;
    }
    return JSON.stringify(a) === JSON.stringify(b);
};

// #endregion Utilities


// #region Settings

class Settings {
    constructor() {
        Object.assign(this, Settings.getDefaultValues());
    }

    static getDefaultValues() {
        return {
            isEnabled: true,                                            // Disable all dynamic functionality.
            ignorePrivateWindows: true,                                 // Don't count tabs for private windows.
            dontSetPrivateWindowTitles: true,                           // Don't set window prefixes in private windows.

            timeBetweenUpdatesInMilliseconds: 100,
            windowPrefixFormat: '[%TabCount%] ',

            windowDefaultName: '',
            windowInheritName: false,
            windowInheritSettings: false,
            windowTrackSessionRestore: true,

            newTabNoTitleWorkaround_Enabled: false,
            newTabNoTitleWorkaround_TrackHandledTabs: false,
            newTabNoTitleWorkaround_LoadWaitInMilliseconds: -1,
            newTabNoTitleWorkaround_ReloadWaitInMilliseconds: 10000,
            newTabNoTitleWorkaround_MinPrefixWaitInMilliseconds: -1,
        };
    }


    // #region Manage storage

    static async get(
        key,                    // string, array of string, or object (property names are keys and values are set values).
        defaultValue = null     // object, or array of objects. Ignored if key is an object (not string).
    ) {
        if (typeof key === "string") {
            return (await browser.storage.local.get({ [key]: defaultValue }))[key];
        } else {
            let data = createObjectFromKeys(key, defaultValue);
            return await browser.storage.local.get(data);
        }
    }
    static async set(
        key,            // string, array of string, or object (property names are keys and values are set values).
        value = null    // object, or array of objects. Ignored if key is an object (not string).
    ) {
        if (typeof key === "string") {
            return await browser.storage.local.set({
                [key]: value
            });
        } else {
            let data = createObjectFromKeys(key, value);
            return await browser.storage.local.set(data);
        }
    }
    static async remove(
        key     // string, or array of strings.
    ) {
        return browser.storage.local.remove(key);
    }
    static async clear() {
        return browser.storage.local.clear();
    }

    // #endregion Manage storage


    static createChangeEventListener(
        callback    // Function that will be called when this event occurs. The function will be passed the following arguments:
        // changes:    object. Object describing the change. This contains one property for each key that changed. The name of the property is the name of the key that changed, and its value is a storage.StorageChange object describing the change to that item.
        // areaName:   string. The name of the storage area ("sync", "local" or "managed") to which the changes were made.
    ) {
        return new EventListener(browser.storage.onChanged, callback);
    }
}


class SettingsTracker {
    constructor(
        storageArea = null,
        callback = null
    ) {
        if (!storageArea || typeof storageArea !== "string") {
            storageArea = "local";
        }

        var onChange = new EventManager();
        this.onChange = onChange.subscriber;
        onChange.addListener(callback);

        this.settings = new Settings();

        let changedProperties = [];
        let changeListener = Settings.createChangeEventListener((changes, areaName) => {
            if (areaName === storageArea) {
                let keys = Object.keys(changes);
                if (changedProperties) {
                    changedProperties.push.apply(keys.filter((change) => !changedProperties.includes(change)));
                }
                for (let key of keys) {
                    let newValue = changes[key].newValue;
                    if (newValue) {
                        this.settings[key] = newValue;
                    } else {
                        delete this.settings[key];
                    }
                }
                onChange.fire(changes, areaName);
            }
        });
        let start = async () => {
            let allSettings = await Settings.get(null);
            for (let key of Object.keys(allSettings)) {
                if (!changedProperties.includes(key)) {
                    this.settings[key] = allSettings[key];
                }
            }
            changedProperties = null;
        };

        this.start = start();
        this.stop = () => {
            changeListener.close();
        };
    }
}

// #endregion Settings


// #region Events

class EventListener {
    constructor(DOMElementOrEventObject, eventNameOrCallback, callback) {
        let onClose = new EventManager();
        this.onClose = onClose.subscriber;

        if (typeof eventNameOrCallback === 'string' && typeof callback === 'function') {
            this._DOMElement = DOMElementOrEventObject;
            this._event = eventNameOrCallback;
            this._callback = callback;
        } else {
            this._event = DOMElementOrEventObject;
            this._callback = eventNameOrCallback;
        }
        if (this._DOMElement) {
            this._DOMElement.addEventListener(this._event, this._callback);
        } else {
            this._event.addListener(this._callback);
        }

        this.close = function () {
            if (this._callback) {
                if (this._DOMElement) {
                    this._DOMElement.removeEventListener(this._event, this._callback);
                } else {
                    this._event.removeListener(this._callback);
                }
                this._callback = null;
                onClose.fire(this);
            }
        };
    }

    get isDisposed() {
        return !Boolean(this._callback);
    }
    get isActive() {
        if (this._DOMElement) {
            return !this.isDisposed;
        } else {
            return this._event.hasListener(this._callback);
        }
    }
}


class EventManager {
    constructor() {
        let manager = this;

        let listeners = [];
        defineProperty(this, 'listeners', () => listeners.slice(), (value) => {
            listeners = value;
            if (onChanged) {
                onChanged.fire(this);
            }
        });
        defineProperty(this, 'listenersLength', () => listeners.length);

        var onChanged;
        defineProperty(this, 'onChanged', () => {
            if (!onChanged) {
                onChanged = new EventManager();
            }
            return onChanged.subscriber;
        });

        this.subscriber = {
            addListener(listener) {
                if (!listener || typeof listener !== 'function') {
                    return;
                }
                if (listeners.includes(listener)) {
                    return;
                }
                listeners.push(listener);
                if (onChanged) {
                    onChanged.fire(manager, listener, true);
                }
            },
            removeListener(listener) {
                if (listeners.includes(listener)) {
                    listeners = listeners.filter((l) => l !== listener);
                    if (onChanged) {
                        onChanged.fire(manager, listener, false);
                    }
                }
            },
            hasListener(listener) {
                return listeners.includes(listener);
            }
        };

        Object.assign(this, this.subscriber);

        this.fire = function () {
            let returned = [];
            if (listeners.length > 0) {
                let args = Array.from(arguments);
                for (let listener of listeners) {
                    try {
                        returned.push(listener.apply(null, args));
                    } catch (error) {
                        console.log('Error during event handling!\n', error);
                    }
                }
            }
            return returned;
        };
    }

    static createPassthroughEventManager(originalEvent, returnModifier = null, argumentModifier = null) {
        var checkIfFunction = (test) => test && typeof test === 'function';
        var hasReturnMod = checkIfFunction(returnModifier);
        var hasArgMod = checkIfFunction(argumentModifier);

        var originalEventListener = null;
        var passthroughEventManager = new EventManager();

        var start = () => {
            if (!originalEventListener) {
                originalEventListener = new EventListener(originalEvent, function () {
                    let args = Array.from(arguments);
                    if (hasArgMod) {
                        args = argumentModifier(args);
                    }
                    let returned = passthroughEventManager.fire.apply(passthroughEventManager, args);
                    if (returned.length === 0) {
                        return;
                    }
                    if (returned.length === 1) {
                        if (hasReturnMod) {
                            return returnModifier(returned[0]);
                        }
                        return returned[0];
                    }
                    let firstNotUndefined;
                    for (let rawValue of returned) {
                        let value = rawValue;
                        if (hasReturnMod) {
                            value = returnModifier(rawValue);
                        }
                        if (value) {
                            return value;
                        }
                        if (firstNotUndefined === undefined && value !== undefined) {
                            firstNotUndefined = value;
                        }
                    }
                    return firstNotUndefined;
                });
            }
        };
        var stop = () => {
            if (originalEventListener) {
                originalEventListener.close();
                originalEventListener = null;
            }
        };

        passthroughEventManager.onChanged.addListener(() => {
            if (passthroughEventManager.listenersLength === 0) {
                stop();
            } else {
                start();
            }
        });

        return passthroughEventManager;
    }
}

// #endregion Events


// #region Delays

class PromiseWrapper {
    constructor(createPromise = true) {
        let _resolve;
        let _reject;
        let _value;
        let _isError = false;
        let _set = false;
        let _promise;
        let _promiseCreated = false;

        let _createPromise = () => {
            if (_promiseCreated) {
                return;
            }
            _promiseCreated = true;
            _promise = new Promise((resolve, reject) => {
                if (_set) {
                    if (_isError) {
                        reject(_value);
                    } else {
                        resolve(_value);
                    }
                } else {
                    _resolve = resolve;
                    _reject = reject;
                }
            });
        };
        let setInternal = (value, isError) => {
            if (_set) {
                return;
            }
            _set = true;
            _isError = isError;
            _value = value;

            this.done = true;
            this.isError = isError;
            this.value = value;

            if (isError) {
                if (_reject) {
                    _reject(value);
                }
            } else {
                if (_resolve) {
                    _resolve(value);
                }
            }
        };


        defineProperty(this, 'promise', () => {
            if (!_promiseCreated) {
                _createPromise();
            }
            return _promise;
        });
        this.resolve = (value) => setInternal(value, false);
        this.reject = (value) => setInternal(value, true);
        this.getValue = () => {
            if (_promiseCreated) {
                return _promise;
            }
            if (!_set || _isError) {
                _createPromise();
                return _promise;
            } else {
                return _value;
            }
        };

        if (createPromise) {
            _createPromise();
        } else {
            this.start = () => _createPromise();
        }
    }
}


class OperationManager {
    constructor() {
        var promiseWrapper = new PromiseWrapper(false);
        let disposableCollection = new DisposableCollection();

        let setValue = (value, isError = false) => {
            if (isError) {
                promiseWrapper.reject(value);
            } else {
                promiseWrapper.resolve(value);
            }
            disposableCollection.dispose();
        };

        this.trackDisposables = (disposables) => disposableCollection.trackDisposables(disposables);

        defineProperty(this, 'done', () => promiseWrapper.done);

        defineProperty(this, 'value',
            () => promiseWrapper.getValue(),
            (value) => setValue(value)
        );

        this.resolve = (value) => setValue(value);
        this.reject = (value) => setValue(value, true);
    }
}


class Timeout {
    constructor(callback, timeInMilliseconds) {
        let onStop = new EventManager();
        this.onStop = onStop.subscriber;

        let timeoutId = null;
        let stop = () => {
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
                timeoutId = null;
                onStop.fire(this);
            }
        };
        if (callback && typeof callback === 'function') {
            timeoutId = setTimeout(() => {
                timeoutId = null;
                callback();
            }, timeInMilliseconds);
        }
        this.stop = () => stop();
        defineProperty(this, 'isActive', () => timeoutId !== null);
    }
}


class RequestManager {
    constructor(callback = null, blockTimeInMilliseconds = 1000, simultaneousUpdates = false) {
        let onUpdateManager = new EventManager();
        this.onUpdate = onUpdateManager.subscriber;
        this.onUpdate.addListener(callback);


        this.blockTimeInMilliseconds = blockTimeInMilliseconds;

        let blockTimeout = null;
        let invalidated = false;
        let disposed = false;
        let updates = 0;
        let lastArgs = [];

        var block = () => {
            if (blockTimeout) {
                blockTimeout.stop();
            }
            if (disposed) {
                return;
            }
            let time;
            if (typeof this.blockTimeInMilliseconds === 'function') {
                time = this.blockTimeInMilliseconds();
            } else {
                time = this.blockTimeInMilliseconds;
            }
            blockTimeout = new Timeout(unblock, time);
            return blockTimeout;
        };
        var unblock = () => {
            if (blockTimeout) {
                blockTimeout.stop();
            }
            if (invalidated) {
                update();
            }
        };
        var update = async () => {
            if (disposed) {
                return;
            }
            if (!simultaneousUpdates && updates > 0) {  // Unblocked but last update has yet to complete.
                return;
            }
            let b = block();
            invalidated = false;
            let args = lastArgs;
            lastArgs = [];

            let releaseBlock = false;
            try {
                updates++;
                releaseBlock = await checkAny(onUpdateManager.fire.apply(null, args));

                if (releaseBlock && b === blockTimeout) {
                    unblock();
                }
            } finally {
                updates--;
                if (updates <= 0 && !getBlocked() && invalidated) {
                    update();
                }
            }
        };
        var getBlocked = () => blockTimeout && blockTimeout.isActive;


        defineProperty(this, 'lastArgs', () => lastArgs);
        defineProperty(this, 'isBlocked', getBlocked);
        defineProperty(this, 'isInvalidated', () => invalidated);
        defineProperty(this, 'isDisposed', () => disposed);

        this.dispose = () => {
            if (disposed) {
                return;
            }
            disposed = true;
            unblock();
        };

        this.invalidate = function () {   // update after block is released.
            invalidated = true;
            lastArgs = Array.from(arguments);
            if (!getBlocked()) {
                update();
            }
        };
        this.unblock = unblock;                     // Unblock and update if invalidated.
        this.forceUpdate = async function () {      // Unblock and update.
            lastArgs = Array.from(arguments);
            await update();
        };
    }
}

// #endregion Delays


class DisposableCollection {
    constructor(initialDisposables) {
        var trackedDisposables = [];
        defineProperty(this, 'array', () => trackedDisposables.slice());
        var disposedEvents = {};
        var isDisposed = false;
        var disposeFunctionNames = [
            'stop',
            'close',
            'cancel',
            'dispose',
        ];
        var onDisposedEventNames = [
            'onStop',
            'onStoped',
            'onClose',
            'onClosed',
            'onCancel',
            'onCanceled',
            'onDispose',
            'onDisposed',
        ];
        var onDisposed = new EventManager();
        this.onDisposed = onDisposed.subscriber;

        var subscribeEvent = (obj, eventName, callback) => {
            if (obj[eventName] && obj[eventName].addListener && typeof obj[eventName].addListener === 'function') {
                return new EventListener(obj[eventName], callback);
            }
            return null;
        };
        var callFunction = (obj, functionName) => {
            if (obj[functionName] && typeof obj[functionName] === 'function') {
                obj[functionName]();
                return true;
            }
            return false;
        };
        var dispose = (obj) => {
            for (let disposeFunctionName of disposeFunctionNames) {
                if (callFunction(obj, disposeFunctionName)) {
                    break;
                }
            }
        };
        var disposeAll = () => {
            for (let disposable of Array.from(trackedDisposables)) {
                dispose(disposable);
            }
        };
        this.dispose = () => {
            if (isDisposed) {
                return;
            }
            disposeAll();
            isDisposed = true;
            onDisposed.fire(this);
        };

        this.trackDisposables = (disposables) => {
            if (!disposables) {
                return;
            }
            if (!Array.isArray(disposables)) {
                disposables = [disposables];
            }
            for (let disposable of disposables) {
                if (!disposable) {
                    continue;
                }
                if (Array.isArray(disposable)) {
                    this.trackDisposables(disposable);
                    continue;
                }
                if (isDisposed) {
                    dispose(disposable);
                }
                if (!trackedDisposables.includes(disposable)) {
                    trackedDisposables.push(disposable);

                    let collection = this;
                    let callback = () => {
                        collection.untrackDisposables(disposable);
                    };
                    for (let eventName of onDisposedEventNames) {
                        let listener = subscribeEvent(disposable, eventName, callback);
                        if (listener) {
                            disposedEvents[disposable] = listener;
                        }
                    }
                }
            }
        };
        this.untrackDisposables = (disposables) => {
            if (isDisposed) {
                return;
            }
            if (!disposables) {
                return;
            }
            if (!Array.isArray(disposables)) {
                disposables = [disposables];
            }
            // trackedDisposables = trackedDisposables.filter(disposable => !disposables.includes(disposable));
            for (let disposable of disposables) {
                if (!disposable) {
                    continue;
                }
                if (Array.isArray(disposable)) {
                    this.untrackDisposables(disposable);
                    continue;
                }
                while (true) {
                    let index = trackedDisposables.indexOf(disposable);
                    if (index < 0) {
                        break;
                    }
                    trackedDisposables.splice(index, 1);
                }

                let listener = disposedEvents[disposable];
                listener.close();
                delete dispatchEvent[disposable];
            }
        };
        defineProperty(this, 'isDisposed', () => isDisposed);

        this.trackDisposables(initialDisposables);
    }
}


// #region HTML Document

// #region Basic

function setTextMessages(elementsToText = null) {
    if (!Array.isArray(elementsToText)) {
        rootElement = document;
        if (elementsToText) {
            rootElement = elementsToText;
        }
        elementsToText = Array.from(rootElement.querySelectorAll(`*[class*='${messagePrefix}']`));
        if (rootElement !== document) {
            elementsToText.push(rootElement);
        }
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

function toggleClass(element, className, enabled) {
    if (enabled) {
        element.classList.add(className);
    } else {
        element.classList.remove(className);
    }
}

// #endregion Basic


// #region Basic Components

function createCheckBox(id, message) {
    let ele = document.createElement('label');

    let checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    if (id) {
        checkbox.id = id;
    }
    ele.appendChild(checkbox);

    let label = document.createElement('text');
    if (message) {
        label.classList.add(messagePrefix + message);
    }
    ele.appendChild(label);

    return { area: ele, checkbox: checkbox, label: label };
}


function createNumberInput(message, min = 0, newLine = false) {
    let timeoutArea = document.createElement('div');

    let timeoutText = document.createElement('text');
    timeoutText.classList.add(messagePrefix + message);
    timeoutArea.appendChild(timeoutText);

    if (newLine) {
        timeoutArea.appendChild(document.createElement('br'));
    }

    let timeoutInput = document.createElement('input');
    timeoutInput.type = 'number';
    if (min || min === 0) {
        timeoutInput.min = min;
    }
    timeoutArea.appendChild(timeoutInput);

    return { area: timeoutArea, input: timeoutInput, text: timeoutText };
}


let globalListInfo;
var listItemDragState = Object.freeze({
    none: null,
    dragged: 'dragged',
    target: 'target',
    appendAfter: 'after',
    draggedAndAppendAfter: 'draggedAndAfter',
    targetAndAppendAfter: 'targetAndAfter',
});
function createListArea() {
    let obj = {};
    let area = document.createElement('div');
    area.classList.add('list');

    let listDropMarker = document.createElement('div');
    listDropMarker.classList.add('dropMarker');
    area.appendChild(listDropMarker);

    let currentListDragState = null;
    let setListDragState = (dragState) => {
        if (currentListDragState === dragState) {
            return;
        }
        _setListDragState(currentListDragState, false);
        _setListDragState(dragState, true);
        currentListDragState = dragState;
    };
    let _setListDragState = (dragState, value) => {
        switch (dragState) {
            case listItemDragState.dragged: {
                toggleClass(area, 'dragged', value);
            } break;

            case listItemDragState.target: {
                toggleClass(area, 'dropTarget', value);
            } break;

            case listItemDragState.appendAfter: {
                toggleClass(area, 'dropTarget', value);
                toggleClass(listDropMarker, 'dropTarget', value);
            } break;

            case listItemDragState.targetAndAppendAfter: {
                _setListDragState(listItemDragState.target, value);
                _setListDragState(listItemDragState.appendAfter, value);
            } break;
        }
    };

    // #region Global

    if (globalListInfo && globalListInfo.isActive) {
        globalListInfo.addList(obj);
    } else {
        let globalInfo = {
            allLists: [obj],
            debugDrag: false,
            eventCollection: null,
        };
        defineProperty(globalInfo, 'isActive', () => {
            return globalInfo.eventCollection && !globalInfo.eventCollection.isDisposed;
        });
        globalListInfo = globalInfo;


        let onListRemoved = new EventManager();

        let addList = (listObj) => {
            globalInfo.allLists.push(listObj);
        };
        let removeList = (listObj) => {
            if (!globalInfo || !globalInfo.allLists) {
                return;
            }
            let all = globalInfo.allLists;
            let index = all.indexOf(listObj);
            if (index < 0) {
                return;
            }
            all.splice(index, 1);
            onListRemoved.fire(listObj);
        };

        let getAllLists = () => {
            for (let listToRemove of globalInfo.allLists.filter(list => !document.documentElement.contains(list.area))) {
                removeList(listToRemove);
            }
            return globalInfo.allLists;
        };
        let getListFromArea = (area) => {
            let all = getAllLists();
            for (let list of all) {
                if (list.area === area) {
                    return list;
                }
            }
            return null;
        };
        let getListFromCoordinate = (x, y) => {

        };

        let checkAllowDropOnList = (dragItemObj, dropListObj) => {
            if (dropListObj.checkAllowDrop && typeof dropListObj.checkAllowDrop === 'function') {
                return dropListObj.checkAllowDrop(dragItemObj);
            }
            return true;
        };
        let checkAllowDropOnItem = (dragItemObj, dropItemObj) => {
            if (dropItemObj.checkAllowDrop && typeof dropItemObj.checkAllowDrop === 'function' && typeof dropItemObj.handleDrop === 'function') {
                return dropItemObj.checkAllowDrop(dragItemObj);
            }
            return false;
        };

        let trackingEventCollection;
        let dragInfo = null;
        let stopDrag = (canceled = true) => {
            document.documentElement.classList.remove('dragging');
            if (trackingEventCollection) {
                trackingEventCollection.dispose();
            }
            if (dragInfo) {
                dragInfo.dragItem.setDragState(listItemDragState.none);
                dragInfo.dragList.setDragState(listItemDragState.none);
                if (dragInfo.dropAfter) {
                    dragInfo.dropAfter.setDragState(listItemDragState.none);
                }
                if (dragInfo.dropItem) {
                    dragInfo.dropItem.setDragState(listItemDragState.none);
                }
                if (!canceled) {
                    if (globalInfo.debugDrag) {
                        console.log('drop success'); console.log(dragInfo);
                    }
                    if (dragInfo.dropItem) {
                        dragInfo.dropItem.handleDrop(dragInfo.dragItem);
                    } else if (dragInfo.dropAfter) {
                        let index = 0;
                        if (dragInfo.dropAfter !== dragInfo.dropList) {
                            index = dragInfo.dropList.items.indexOf(dragInfo.dropAfter) + 1;
                            if (dragInfo.dropList === dragInfo.dragList) {
                                let currentIndex = dragInfo.dragList.items.indexOf(dragInfo.dragItem);
                                if (currentIndex < index) {
                                    index--;
                                }
                            }
                        }
                        dragInfo.dropList.insertItem(dragInfo.dragItem, index);
                    }
                }
            }
            dragInfo = null;
        };
        let startDrag = (list, listItem) => {
            let dragListObj = getListFromArea(list);
            let dragItemObj;
            if (dragListObj) {
                dragItemObj = dragListObj.getItemByArea(listItem);
            }

            if (!dragListObj || !dragItemObj) {
                if (globalInfo.debugDrag) {
                    console.log('Cancel drag start due to list or item not found'); console.log(dragListObj); console.log(dragItemObj);
                }
                return;
            }
            stopDrag();

            dragInfo = {
                dragList: dragListObj,
                dragItem: dragItemObj,

                dropList: dragListObj,
            };
            document.documentElement.classList.add('dragging');

            dragItemObj.section.isCollapsed = true;

            dragItemObj.setDragState(listItemDragState.dragged);
            dragListObj.setDragState(listItemDragState.dragged);

            let lastMouseEvent;     // (mouse pos relative to scrolled view of document)
            let dropUpdater = new RequestManager(() => {
                if (dragEventsCollection && dragEventsCollection.isDisposed) {
                    return;
                }
                // Keep updating in case an element is resized or the page is scrolled or the page is zoomed.
                dropUpdater.invalidate();
                if (!dragEventsCollection || !lastMouseEvent) {
                    return;
                }


                // #region Get Mouse Info

                let e = lastMouseEvent;
                let bodyPos = document.body.getBoundingClientRect();    // Since the scrolling is handled by Firefox's extension page this will allways be positioned at (0, 0). Still used here for future proofing.
                let mousePos = {
                    x: lastMouseEvent.clientX - bodyPos.left,
                    y: lastMouseEvent.clientY - bodyPos.top,
                };

                if (globalInfo.debugDrag) {
                    console.log('move'); console.log(e); console.log(bodyPos);
                }

                document.documentElement.classList.add('dontBlockScreen');
                let mouseTarget = document.elementFromPoint(mousePos.x, mousePos.y);
                document.documentElement.classList.remove('dontBlockScreen');

                // #endregion Get Mouse Info


                // #region Find most nested allowed list at mouse position

                let findList = (ele, checkBounding = false) => {
                    let lastList;
                    while (ele) {
                        if (ele.classList.contains('list')) {
                            let listObj = getListFromArea(ele);
                            if (listObj && checkAllowDropOnList(dragInfo.dragItem, listObj)) {
                                if (checkBounding) {
                                    let pos = ele.getBoundingClientRect();
                                    if (mousePos.x < pos.left || pos.right < mousePos.x || mousePos.y < pos.top || pos.bottom < mousePos.y) {
                                        lastList = listObj;
                                    } else {
                                        lastList = null;
                                    }
                                }
                                if (!lastList) {
                                    return listObj;
                                }
                            }
                        }
                        ele = ele.parentElement;
                    }
                    if (lastList) {
                        return lastList;
                    }
                    return ele;
                };
                let dropListObj = findList(mouseTarget);
                if (!dropListObj) {
                    dropListObj = findList(dragInfo.dropList.area, true);
                }
                if (dropListObj && dragInfo.dropList !== dropListObj) {
                    dragInfo.dropList.setDragState(listItemDragState.none);
                    dragInfo.dropList = dropListObj;
                    dragInfo.dropList.setDragState(listItemDragState.target);
                    if (globalInfo.debugDrag) {
                        console.log('Drag - Parent List'); console.log(dropListObj);
                    }
                }

                // #endregion Find most nested allowed list at mouse position


                let listTarget = dragInfo.dropList;
                let targetItems = listTarget.getAllItems();

                let insertIndex = null;
                let dropItem = null;
                for (let iii = 0; iii < targetItems.length; iii++) {
                    let targetItem = targetItems[iii];
                    let itemPos = targetItem.section.area.getBoundingClientRect();
                    if (mousePos.y < itemPos.top) {
                        if (!insertIndex && insertIndex !== 0) {
                            insertIndex = iii;
                        }
                    } else if (mousePos.y > itemPos.bottom) {
                        insertIndex = iii + 1;
                    } else {
                        if (itemPos.left < mousePos.x && mousePos.x < itemPos.right && targetItem !== dragInfo.dragItem && checkAllowDropOnItem(dragInfo.dragItem, targetItem)) {
                            dropItem = targetItem;
                        } else {
                            let itemHeight = itemPos.bottom - itemPos.top;
                            let middle = itemPos.top + itemHeight / 2;
                            if (mousePos.y > middle) {
                                insertIndex = iii + 1;
                            } else {
                                insertIndex = iii;
                            }
                        }
                        break;
                    }
                }
                if (!insertIndex) {
                    insertIndex = 0;
                }

                if (dropItem !== dragInfo.dropItem) {
                    if (dragInfo.dropItem) {
                        let getDragState = () => {
                            if (dragInfo.dropItem === dragInfo.dropAfter) {
                                return listItemDragState.appendAfter;
                            }
                            return listItemDragState.none;
                        };
                        dragInfo.dropItem.setDragState(getDragState());
                    }
                    dragInfo.dropItem = dropItem;
                    if (dragInfo.dropItem) {
                        dropItem.setDragState(listItemDragState.target);
                    }
                }

                insertIndex--;
                let dropAfter;
                if (dropItem) {
                    dropAfter = null;
                } else if (insertIndex < 0 || insertIndex > targetItems.length) {
                    dropAfter = dragInfo.dropList;
                } else {
                    dropAfter = targetItems[insertIndex];
                }

                if (dragInfo.dropAfter !== dropAfter) {
                    if (dragInfo.dropAfter) {
                        let getDragState = () => {
                            if (dragInfo.dropAfter === dragInfo.dropList) {
                                return listItemDragState.target;
                            }
                            if (dragInfo.dropAfter === dragInfo.dropItem) {
                                return listItemDragState.target;
                            }
                            if (dragInfo.dropAfter === dragInfo.dragItem) {
                                return listItemDragState.dragged;
                            }
                            return listItemDragState.none;
                        };
                        dragInfo.dropAfter.setDragState(getDragState());
                    }
                    dragInfo.dropAfter = dropAfter;
                    let getDragState = () => {
                        if (dragInfo.dropAfter === dragInfo.dragItem) {
                            return listItemDragState.draggedAndAppendAfter;
                        }
                        if (dragInfo.dropAfter === dragInfo.dropList) {
                            return listItemDragState.targetAndAppendAfter;
                        }
                        return listItemDragState.appendAfter;
                    };
                    dropAfter.setDragState(getDragState());
                }
            }, globalInfo.debugDrag ? 250 : 50);
            dropUpdater.invalidate();

            var dragEventsCollection = new DisposableCollection([
                new EventListener(document, 'wheel', (e) => {
                    lastMouseEvent = e;
                }),
                new EventListener(document, 'mousemove', (e) => {
                    lastMouseEvent = e;
                }),
                /* Other mouse events:
                new EventListener(document.body, 'mouseenter', (e) => {
                    if (globalInfo.debugDrag) {
                        console.log('enter (page)'); console.log(e);
                    }
                }),
                new EventListener(document.body, 'mouseleave', (e) => {
                    if (globalInfo.debugDrag) {
                        console.log('leave (page)'); console.log(e);
                    }
                }),
                new EventListener(document, 'mouseover', (e) => {
                    if (globalInfo.debugDrag) {
                        console.log('enter'); console.log(e);
                    }
                    let ele = e.target;
                    if (!ele) {
                        return;
                    }
                    if (dragInfo.dropList !== ele && ele.classList.contains('list') && checkAllowListDrop(getListFromArea(ele))) {
                        dragInfo.dropList = ele;
                        if (globalInfo.debugDrag) {
                            console.log('Drag - Nested List'); console.log(ele);
                        }
                    }
                    if (ele.classList.contains('listItem')) {

                    }
                }),
                new EventListener(document, 'mouseout', (e) => {
                    if (globalInfo.debugDrag) {
                        console.log('leave'); console.log(e);
                    }
                }),*/
            ]);
            trackingEventCollection = dragEventsCollection;
        };

        Object.assign(globalInfo, {
            getAllLists: getAllLists,

            addList: addList,
            removeList: removeList,

            onListRemoved: onListRemoved.subscriber,

            stopDrag: stopDrag,
            startDrag: startDrag,
        });

        let dragStartStopCollection = new DisposableCollection([
            new EventListener(document, 'mousedown', (e) => {
                if (globalInfo.debugDrag) {
                    console.log('button down'); console.log(e);
                }
                if (e.buttons !== 1) {
                    stopDrag();
                    return;
                }
                if (dragInfo) {
                    return;
                }
                let ele = e.target;
                while (ele) {
                    if (ele.classList.contains('draggable')) {
                        break; // Found draggable element
                    }
                    ele = ele.parentElement;
                }
                if (ele && !ele.classList.contains('listItemDrag')) {
                    return; // Dragged item is not a list item.
                }
                while (ele) {
                    if (ele.classList.contains('listItem')) {
                        break;
                    }
                    ele = ele.parentElement;
                }
                let listEle = ele;
                while (listEle) {
                    if (listEle.classList.contains('list')) {
                        break;
                    }
                    listEle = listEle.parentElement;
                }
                if (!ele || !listEle) {
                    return; // No draggable item was found.
                }
                // ele is the listItem being dragged.
                // listEle is the list the item is a part of.
                startDrag(listEle, ele);
            }),
            new EventListener(document, 'mouseup', (e) => {
                if (globalInfo.debugDrag) {
                    console.log('button up'); console.log(e);
                }
                stopDrag(e.buttons % 2 !== 0);
            }),
            new EventListener(document, 'keydown', (e) => {
                if (globalInfo.debugDrag) {
                    console.log('key down'); console.log(e);
                }
                if (e.key === 'Escape') {
                    stopDrag();
                }
            }),
            new EventListener(document, 'blur', (e) => {
                if (globalInfo.debugDrag) {
                    console.log('document lost focus'); console.log(e);
                }
                stopDrag();
            }),
        ]);
        new EventManager(dragStartStopCollection.onDisposed, () => {
            stopDrag();
        });
        globalInfo.eventCollection = dragStartStopCollection;
    }

    let onRemoved = new EventManager();
    let onRemoveListener = new EventListener(globalListInfo.onListRemoved, (removeList) => {
        if (removeList !== obj) {
            return;
        }
        onRemoved.fire(obj);
        onRemoveListener.close();
        console.log('removed list');
    });

    // #endregion Global


    // #region Item Management

    let itemObjs = [];
    let onItemArrayChange = new EventManager();

    var getAllItems = () => {
        for (let item of itemObjs.filter(item => item.list !== obj || !area.contains(item.area))) {
            removeitem(item);
        }
        return itemObjs;
    };
    var getItemByArea = (itemArea) => {
        let all = getAllItems();
        for (let item of all) {
            if (item.area === itemArea) {
                return item;
            }
        }
        return null;
    };
    var insertItem = (itemObj, index = -1) => {
        if (!itemObj) {
            return;
        }

        getAllItems();  // Update itemObjs array.
        let previousList = itemObj.list;

        // Remove current entries of item:
        itemObjs = itemObjs.filter(item => item !== itemObj);

        if (index < 0 || index >= itemObjs.length) {
            // Insert last
            area.appendChild(itemObj.area);
            itemObjs.push(itemObj);
            index = itemObjs.length - 1;
        } else {
            area.insertBefore(itemObj.area, itemObjs[index].area);
            itemObjs.splice(index, 0, itemObj);
        }

        itemObj.list = obj;

        if (previousList && previousList !== obj) {
            previousList.removeItem(itemObj);
        }
        onItemArrayChange.fire(obj, itemObj, index);
    };
    var addItem = (itemObj) => {
        if (itemObjs.includes(itemObj)) {
            return;
        }
        insertItem(itemObj);
    };
    var removeItem = (itemObj) => {
        if (Array.from(area.children).includes(itemObj.area)) {
            area.removeChild(itemObj.area);
        }

        if (itemObj.list) {
            itemObjs = itemObjs.filter(item => item !== itemObj);
        } else {
            itemObj.remove();
        }
        onItemArrayChange.fire(obj, itemObj, false);
    };

    var createItem = () => {
        let itemObj = {};
        let onListChange = new EventManager();
        let onRemoved = new EventManager();
        let onDrop = new EventManager();
        let onCheckDrop = new EventManager();

        let item = document.createElement('div');
        item.classList.add('listItem');

        let itemSectionWrapper = document.createElement('div');
        itemSectionWrapper.classList.add('sectionWrapper');
        item.appendChild(itemSectionWrapper);

        let itemSection = createCollapsableArea();
        itemSectionWrapper.appendChild(itemSection.area);

        let dropMarkerAfter = document.createElement('div');
        dropMarkerAfter.classList.add('dropMarker');
        item.appendChild(dropMarkerAfter);

        let dragWrapper = document.createElement('div');
        dragWrapper.classList.add('listItemDragWrapper');
        itemSection.title.appendChild(dragWrapper);

        let draggableArea = document.createElement('div');
        draggableArea.classList.add('dragIcon');
        draggableArea.classList.add('listItemDrag');
        draggableArea.classList.add('draggable');
        draggableArea.classList.add('preventOpen');
        dragWrapper.appendChild(draggableArea);

        for (let iii = 0; iii < 3; iii++) {
            let dragIconLine = document.createElement('div');
            dragIconLine.classList.add('dragIconLine');
            draggableArea.appendChild(dragIconLine);
        }

        let itemsList = null;

        let remove = () => {
            let list = itemsList;
            itemsList = null;
            if (list) {
                list.removeItem(itemObj);
            }
            getAllLists();  // Dispose of all lists not part of the document. Some might have been part of the removed item.
            onRemoved.fire(itemObj);
        };

        let setList = (value) => {
            if (!value) {
                remove();
                return;
            }
            if (itemsList === value) {
                return;
            }
            let oldList = itemsList;

            value.addItem(itemObj);
            itemsList = value;

            onListChange.fire(itemObj, oldList, value);
        };
        let getList = () => {
            return itemsList;
        };

        let currentDragState = null;
        let setDragState = (dragState) => {
            if (currentDragState === dragState) {
                return;
            }
            _setDragState(currentDragState, false);
            _setDragState(dragState, true);
            currentDragState = dragState;
        };
        let _setDragState = (dragState, value) => {
            switch (dragState) {
                case listItemDragState.dragged: {
                    toggleClass(draggableArea, 'dragged', value);
                    toggleClass(item, 'dragged', value);
                } break;

                case listItemDragState.target: {
                    toggleClass(item, 'dropTarget', value);
                } break;

                case listItemDragState.appendAfter: {
                    toggleClass(dropMarkerAfter, 'dropTarget', value);
                } break;

                case listItemDragState.draggedAndAppendAfter: {
                    _setDragState(listItemDragState.dragged, value);
                    _setDragState(listItemDragState.appendAfter, value);
                } break;
            }
        };


        Object.assign(itemObj, {
            area: item,
            section: itemSection,

            setDragState: setDragState,
            handleDrop: (draggedItemObj) => onDrop.fire(draggedItemObj),
            checkAllowDrop: (draggedItemObj) => (onCheckDrop.fire(draggedItemObj).filter(returnValue => returnValue).length > 0),

            remove: remove,

            onRemoved: onRemoved.subscriber,        // Args: itemObj
            onListChange: onListChange.subscriber,  // Args: itemObj, oldList, newList

            onDrop: onDrop.subscriber,
            onCheckDrop: onCheckDrop.subscriber,
        });
        defineProperty(itemObj, 'list', getList, setList);

        insertItem(itemObj);

        return itemObj;
    };

    // #endregion Item Management

    let onCheckListDrop = new EventManager();
    let checkDrop = (draggedItemObj) => {
        let returned = onCheckListDrop.fire(draggedItemObj);
        if (returned.length === 0) {
            return true;
        }
        return returned.filter(value => value).length > 0;
    };

    Object.assign(obj, {
        area: area,

        setDragState: setListDragState,
        checkAllowDrop: checkDrop,

        createItem: createItem,

        getAllItems: getAllItems,
        getItemByArea: getItemByArea,

        addItem: addItem,
        removeItem: removeItem,
        insertItem: insertItem,

        onArrayChanged: onItemArrayChange.subscriber,   // Args: listObj, itemObj, newIndexOrFalseIfRemoved
        onRemoved: onRemoved.subscriber,                // Fired when this list is removed from the document. Args: listObj
        onCheckDrop: onCheckListDrop.subscriber,
    });
    defineProperty(obj, 'items', getAllItems);
    return obj;
}


function createCollapsableArea() {
    let area = document.createElement('div');
    area.classList.add('collapsable');
    area.classList.add('section');

    let isCollapsed = true;
    let setCollapsed = (value) => {
        toggleClass(area, 'open', !value);
        isCollapsed = value;
    };
    setCollapsed(isCollapsed);

    let headerArea = document.createElement('div');
    headerArea.classList.add('headerArea');
    headerArea.classList.add('textNotSelectable');
    area.appendChild(headerArea);

    headerArea.addEventListener('click', (e) => {
        let ele = e.target;
        while (ele) {
            if (ele === headerArea) {
                break;
            }
            if (ele.classList.contains('preventOpen')) {
                return;
            }
            ele = ele.parentElement;
        }
        setCollapsed(!isCollapsed);
    });

    let contentWrapper = document.createElement('div');
    contentWrapper.classList.add('contentWrapper');
    area.appendChild(contentWrapper);

    let contentArea = document.createElement('div');
    contentArea.classList.add('contentArea');
    contentWrapper.appendChild(contentArea);

    let obj = {
        area: area,
        title: headerArea,
        content: contentArea,
    };
    defineProperty(obj, 'isCollapsed', () => isCollapsed, setCollapsed);
    return obj;
}


let firstDropDownArea = true;
function createDropDownButton(defaultButtonText = '', closeOnlyOnSelect = true, useGlobalCloseEvent = true) {

    // #region Area Set Up

    // Arrow symbols: https://en.wikipedia.org/wiki/Arrow_(symbol)#Arrows_by_Unicode_block
    let area = document.createElement('div');
    area.classList.add('dropDownArea');
    area.classList.add('defaultName');

    let button = document.createElement('button');
    button.classList.add('dropDownButton');
    area.appendChild(button);

    let buttonTitle = document.createElement('text');
    buttonTitle.textContent = defaultButtonText;
    buttonTitle.classList.add('title');
    button.appendChild(buttonTitle);

    let buttonArrow = document.createElement('text');
    buttonArrow.textContent = '⯆';
    buttonArrow.classList.add('arrow');
    button.appendChild(buttonArrow);

    let setButtonText = (value) => {
        buttonTitle.textContent = value;
    };
    let getButtonText = () => button.textContent;
    setButtonText(defaultButtonText);

    let menu = document.createElement('div');
    menu.classList.add('dropDownContent');
    area.appendChild(menu);

    let getShow = () => area.classList.contains('open');
    let setShow = (value) => {
        toggleClass(area, 'open', value);
    };
    setShow(false);

    button.addEventListener('click', () => {
        setShow(!getShow());
    });
    if (!closeOnlyOnSelect) {
        menu.addEventListener('click', () => {
            setShow(false);
        });
    }
    if (!useGlobalCloseEvent) {
        area.addEventListener('focusout', (event) => {
            setShow(false);
        });
    } else if (firstDropDownArea) {
        let closeAll = (elementToIgnoreParentElementsFor) => {
            var dropDownAreas = Array.from(document.getElementsByClassName("dropDownArea"));
            dropDownAreas = dropDownAreas.filter(dropDown => dropDown.classList.contains('open'));
            if (dropDownAreas.length === 0) {
                return;
            }

            let ignoredAreas = [];
            while (elementToIgnoreParentElementsFor) {
                if (elementToIgnoreParentElementsFor.classList.contains('dropDownArea')) {
                    ignoredAreas.push(elementToIgnoreParentElementsFor);
                }
                elementToIgnoreParentElementsFor = elementToIgnoreParentElementsFor.parentElement;
            }

            dropDownAreas = dropDownAreas.filter(dropDown => !ignoredAreas.includes(dropDown));
            for (let dropDownArea of dropDownAreas) {
                dropDownArea.classList.remove('open');
            }
        };
        document.addEventListener('mousedown', (event) => {
            closeAll(event.target);
        });
        document.addEventListener('blur', (event) => {
            // Window lost focus
            closeAll();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                closeAll();
            }
        });

        firstDropDownArea = false;
    }

    // #endregion Area Set Up


    // #region Item Management

    let onSelectionChangeManager = new EventManager();

    let selected = null;
    let itemObjs = [];
    let setSelected = (obj) => {
        if (selected === obj) {
            return;
        }
        if (obj && !obj.isSelectable) {
            return;
        }
        if (obj && !itemObjs.includes(obj)) {
            return;
        }
        if (!selected || !obj) {
            toggleClass(area, 'defaultName', !obj);
        }
        selected = obj;
        setButtonText(obj ? obj.title : defaultButtonText);
        onSelectionChangeManager.fire(selected);
    };
    let getSelected = () => {
        if (selected && selected.area && selected.area.parentElement !== menu) {
            setSelected(itemObjs.length > 0 ? itemObjs[0] : null);
        }
        return selected;
    };
    let setSelectedIndex = (index) => {
        if (itemObjs.length === 0) {
            setSelected(null);
        } else if (index <= 0) {
            setSelected(itemObjs[0]);
        } else if (index >= itemObjs.length) {
            setSelected(itemObjs[itemObjs.length - 1]);
        } else {
            setSelected(itemObjs[index]);
        }
    };
    let getSelectedIndex = () => {
        return itemObjs.indexOf(selected);
    };

    let clearItems = () => {
        setSelected(null);
        while (menu.firstChild) {
            menu.removeChild(menu.firstChild);
        }
        let removeItems = itemObjs;
        itemObjs = [];
        for (let item of removeItems) {
            item.remove();
        }
    };

    let createItem = (title = '', isSelectable = true, selectIfNoneSelected = true) => {
        var obj = {};
        let onSelected = new EventManager();
        let onClicked = new EventManager();
        let selectionEventListener = new EventListener(onSelectionChangeManager.subscriber, (selected) => {
            if (selected === obj) {
                onSelected.fire(selected);
            }
        });


        let item = document.createElement('div');
        let setItemTitle = (value) => {
            item.textContent = title;
        };
        let getItemTitle = () => {
            return item.textContent;
        };
        setItemTitle(title);

        let setSelectable = (value) => {
            toggleClass(item, 'selectable', value);
        };
        let getSelectable = () => {
            return item.classList.contains('selectable');
        };
        setSelectable(isSelectable);


        menu.appendChild(item);
        itemObjs.push(obj);

        let unselect = (selectNext = true) => {
            if (obj === getSelected()) {
                if (selectNext) {
                    setSelectedIndex(itemObjs.indexOf(obj) + 1);
                } else {
                    setSelected(null);
                }
            }
        };

        let remove = () => {
            if (itemObjs.includes(obj)) {
                unselect();
                menu.removeChild(item);
                itemObjs = itemObjs.filter(item => item !== obj);
            }
            selectionEventListener.close();
        };

        item.addEventListener('click', () => {
            if (getSelectable()) {
                if (closeOnlyOnSelect) {
                    setShow(false);
                }
                setSelected(obj);
            }
            onClicked.fire(obj);
        });

        Object.assign(obj, {
            area: item,

            remove: remove,
            unselect: unselect,

            onSelected: onSelected.subscriber,
            onClicked: onClicked.subscriber,
        });
        defineProperty(obj, 'title', getItemTitle, setItemTitle);
        defineProperty(obj, 'isSelected', () => getSelected() === obj, (value) => value ? setSelected(obj) : unselect(false));
        defineProperty(obj, 'isSelectable', getSelectable, setSelectable);

        if (selectIfNoneSelected && getSelected() === null) {
            setSelected(obj);
        }

        return obj;
    };

    // #endregion Item Management


    let setDefaultButtonText = (value) => {
        if (value === defaultButtonText) {
            return;
        }
        defaultButtonText = value;
        if (!getSelected()) {
            setButtonText(defaultButtonText);
        }
    };
    let getDefaultButtonText = () => {
        return defaultButtonText;
    };



    let obj = {
        area: area,
        menu: menu,

        createItem: createItem,
        clearMenu: clearItems,

        onSelectionChanged: onSelectionChangeManager.subscriber,
    };
    defineProperty(obj, 'isShown', getShow, setShow);
    defineProperty(obj, 'title', getButtonText, setButtonText);
    defineProperty(obj, 'defaultTitle', getDefaultButtonText, setDefaultButtonText);

    defineProperty(obj, 'items', () => itemObjs.slice());
    defineProperty(obj, 'selectedItem', getSelected, setSelected);
    defineProperty(obj, 'selectedIndex', getSelectedIndex, setSelectedIndex);

    return obj;
}


function createTabArea() {
    let tabArea = document.createElement('div');
    tabArea.classList.add('tabArea');

    let createFiller = () => {
        let filler = document.createElement('div');
        filler.classList.add('filler');
        return filler;
    };

    let tabHeadersWrapper = document.createElement('div');
    tabHeadersWrapper.classList.add('tabHeaderListWrapper');
    tabArea.appendChild(tabHeadersWrapper);

    tabHeadersWrapper.appendChild(createFiller());

    let tabHeaders = document.createElement('div');
    tabHeaders.classList.add('tabHeaderList');
    tabHeadersWrapper.appendChild(tabHeaders);

    tabHeadersWrapper.appendChild(createFiller());

    let tabContents = document.createElement('div');
    tabContents.classList.add('tabContentList');
    tabArea.appendChild(tabContents);

    let tabs = [];

    let getTabs = () => {
        return tabs;
    };
    let unselectAll = () => {
        for (let tab of tabs) {
            tab.selected = false;
        }
    };
    let getSelectedTab = () => {
        for (let tab of getTabs()) {
            if (tab.selected) {
                return tab;
            }
        }
        return null;
    };

    let createTab = (message) => {
        let tabHeaderWrapper = document.createElement('div');
        tabHeaderWrapper.classList.add('tabHeaderWrapper');
        tabHeaderWrapper.classList.add('textNotSelectable');
        tabHeaders.appendChild(tabHeaderWrapper);

        tabHeaderWrapper.appendChild(createFiller());

        let tabHeader = document.createElement('div');
        tabHeader.classList.add('tabHeader');
        tabHeaderWrapper.appendChild(tabHeader);

        tabHeaderWrapper.appendChild(createFiller());

        let tabContent = document.createElement('div');
        tabContent.classList.add('tabContent');
        tabContents.appendChild(tabContent);

        let getSelected = () => {
            if (tabHeaderWrapper.classList.contains('active') && tabContent.classList.contains('active')) {
                return true;
            }
            return false;
        };
        let setSelected = (value) => {
            if (value) {
                unselectAll();
            }
            toggleClass(tabHeaderWrapper, 'active', value);
            toggleClass(tabContent, 'active', value);
        };

        let remove = () => {
            tabHeaders.removeChild(tabHeaderWrapper);
            tabContents.removeChild(tabContent);
            tabs = tabs.filter(tab => obj !== tab);
        };

        tabHeader.addEventListener('click', () => {
            setSelected(true);
        });

        if (!getSelectedTab()) {
            setSelected(true);
        }

        if (message) {
            let title = document.createElement('label');
            title.classList.add(messagePrefix + message);
            tabHeader.appendChild(title);
        }

        var obj = {
            header: tabHeader,
            content: tabContent,
            remove: remove,
        };
        defineProperty(obj, 'selected', getSelected, setSelected);
        tabs.push(obj);
        return obj;
    };

    let obj = {
        area: tabArea,
        createTab: createTab,
    };
    return obj;
}

// #endregion Basic Components

// #endregion HTML Document
