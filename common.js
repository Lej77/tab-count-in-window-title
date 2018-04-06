
// #region Constants

const tabCountPlaceholder = '%TabCount%';
const tabCountRegExp = new RegExp(tabCountPlaceholder, "ig");

const totalTabCountPlaceholder = '%TotalTabCount%';
const totalTabCountRegExp = new RegExp(totalTabCountPlaceholder, "ig");

// #endregion Constants


// #region Utilities

async function delay(timeInMilliseconds) {
    return await new Promise((resolve, reject) => setTimeout(resolve, timeInMilliseconds));
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

// #endregion Utilities


class Settings {
    constructor() {
        Object.assign(this, Settings.getDefaultValues());
    }

    static getDefaultValues() {
        return {
            isEnabled: true,
            ignorePrivateWindows: true,

            timeBetweenUpdatesInMilliseconds: 100,
            windowPrefixFormat: '[%TabCount%] ',
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
                try {
                    if (callback && typeof callback === "function") {
                        callback(changes, areaName);
                    }
                } catch (error) { }
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


// #region Events

class EventListener {
    constructor(DOMElementOrEventObject, eventNameOrCallback, callback) {
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
    }

    close() {
        if (this._callback) {
            if (this._DOMElement) {
                this._DOMElement.removeEventListener(this._event, this._callback);
            } else {
                this._event.removeListener(this._callback);
            }
            this._callback = null;
        }
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
        let listeners = [];

        this.subscriber = {
            addListener(listener) {
                if (!listener || typeof listener !== 'function') {
                    return;
                }
                if (listeners.includes(listener)) {
                    return;
                }
                listeners.push(listener);
            },
            removeListener(listener) {
                if (listeners.includes(listener)) {
                    listeners = listeners.filter((l) => l !== listener);
                }
            },
            hasListener(listener) {
                return listeners.includes(listener);
            }
        };

        Object.assign(this, this.subscriber);

        this.fire = function () {
            let returned = [];
            let args = Array.from(arguments);
            for (let listener of listeners) {
                try {
                    returned.push(listener.apply(null, args));
                } catch (error) {
                    console.log('Error during event handling!' + '\n' + error);
                }
            }
            return returned;
        };
        defineProperty(this, 'listeners', () => listeners, (value) => { listeners = value; });
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
        let timeoutId = null;
        let stop = () => {
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
                timeoutId = null;
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
        var isDisposed = false;
        var disposeFunctionNames = [
            'stop',
            'close',
            'cancel',
            'dispose',
        ];
        var onDisposed = new EventManager();
        this.onDisposed = onDisposed.subscriber;

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
            for (let disposable of trackedDisposables) {
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
                if (isDisposed) {
                    dispose(disposable);
                }
                if (!trackedDisposables.includes(disposable)) {
                    trackedDisposables.push(disposable);
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
            trackedDisposables = trackedDisposables.filter(disposable => !disposables.includes(disposable));
        };
        defineProperty(this, 'isDisposed', () => isDisposed);

        this.trackDisposables(initialDisposables);
    }
}
