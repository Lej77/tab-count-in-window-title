
// #region Standard elements

let gScreenBlocker = null;
function toggleScreenBlocker(value) {
  if (!gScreenBlocker) {
    gScreenBlocker = document.createElement('div');
    gScreenBlocker.classList.add('screenBlocker');
    document.body.appendChild(gScreenBlocker);
  }
  toggleClass(document.documentElement, 'blockScreen', value);
}

let gBrowserActionPrompt = null;
function toggleBrowserActionPrompt(value, yPos = null) {
  if (!gBrowserActionPrompt) {
    gBrowserActionPrompt = document.createElement('div');
    gBrowserActionPrompt.classList.add('browserActionPrompt');
    gBrowserActionPrompt.classList.add('prompt');
    document.documentElement.appendChild(gBrowserActionPrompt);

    let browserActionPromptInfo = document.createElement('div');
    browserActionPromptInfo.classList.add(messagePrefix + 'optionalPermissions_BrowserActionPrompt');
    gBrowserActionPrompt.appendChild(browserActionPromptInfo);

    setTextMessages(gBrowserActionPrompt);
  }

  toggleScreenBlocker(value);
  toggleClass(document.documentElement, 'prompting', value);
  toggleClass(gBrowserActionPrompt, 'active', value);

  if (yPos || yPos === 0) {
    gBrowserActionPrompt.style.top = yPos + 'px';
  }
}

// #endregion Standard elements


// #region Basic

function setTextMessages(elementsToText = null) {
  if (!Array.isArray(elementsToText)) {
    let rootElement = document;
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

function bindElementIdsToSettings(settings, createListeners = true) {
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
    if (createListeners) {
      element.addEventListener("input", e => {
        Settings.set(key, e.target[propertyName]);
      });
    }
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


function createStatusIndicator(headerMessage, enabledMessage, disabledMessage, errorMessage = null) {
  let areaWrapper = document.createElement('div');
  areaWrapper.classList.add('statusIndicatorWrapper');

  let area = document.createElement('div');
  area.classList.add('statusIndicator');
  area.classList.add('textNotSelectable');
  areaWrapper.appendChild(area);

  let createSubelement = (className, message = null) => {
    let node = document.createElement('div');
    node.classList.add(className);
    if (message) {
      node.classList.add(messagePrefix + message);
    }
    area.appendChild(node);
    return node;
  };

  createSubelement('statusIndicatorHeader', headerMessage);
  createSubelement('statusIndicatorEnabled', enabledMessage);
  createSubelement('statusIndicatorDisabled', disabledMessage);
  createSubelement('statusIndicatorError', errorMessage);


  let obj = {
    area: areaWrapper
  };
  defineProperty(obj, 'isEnabled', () => area.classList.contains('enabled'), (value) => toggleClass(area, 'enabled', value));
  defineProperty(obj, 'hasError', () => area.classList.contains('error'), (value) => toggleClass(area, 'error', value));
  return obj;
}


let gListInfo;
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

  if (gListInfo && gListInfo.isActive) {
    gListInfo.addList(obj);
  } else {
    let globalInfo = {
      allLists: [obj],
      debugDrag: false,
      eventCollection: null,
    };
    defineProperty(globalInfo, 'isActive', () => {
      return globalInfo.eventCollection && !globalInfo.eventCollection.isDisposed;
    });
    gListInfo = globalInfo;


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
  let onRemoveListener = new EventListener(gListInfo.onListRemoved, (removeList) => {
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
      removeItem(item);
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
      gListInfo.getAllLists();  // Dispose of all lists not part of the document. Some might have been part of the removed item.
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


function createCollapsableArea(animationInfo = {}) {

  // #region Animation Info

  let setAnimationInfo = (value) => {

    // #region Check Arg

    animationInfo = value;
    if (animationInfo === undefined) {
      animationInfo = {};
    } else if (!animationInfo) {
      animationInfo = { reset: true, standard: false };
    }
    if (!Object.keys(animationInfo).includes('standard')) {
      animationInfo.standard = true;
    }
    animationInfo.reset = true;

    // #endregion Check Arg


    // #region Functions

    if (!animationInfo.update || !animationInfo.getPrefixed) {

      let changeFirstLetter = (string, toUpperCase = true) => {
        let firstLetter = string.charAt(0);
        firstLetter = toUpperCase ? firstLetter.toUpperCase() : firstLetter.toLowerCase();
        return firstLetter + string.slice(1);
      };

      // #region Get from Prefix

      if (!animationInfo.getPrefixed) {
        animationInfo.getPrefixed = (prefix) => {
          if (!prefix || typeof prefix !== 'string') {
            prefix = '';
          }
          let info = {};
          let keys = Object.keys(animationInfo);
          for (let key of keys) {
            if (key.startsWith(prefix)) {
              info[changeFirstLetter(key.slice(prefix.length), false)] = animationInfo[key];
            }
          }
          return info;
        };
      }

      // #endregion Get from Prefix


      // #region Update

      if (!animationInfo.update) {
        let standardAnimationInfo = {
          collapseDuration: 200, expandDuration: 200,
          collapseDelay: 0, expandDelay: 0,
          collapseTransition: '', expandTransition: '',
          collapseDurationPerPixel: 0.4, expandDurationPerPixel: 0.4,
          collapseBodyImmediately: true, expandBodyImmediately: true,
        };
        let resetAnimationInfo = { duration: 0, delay: 0, transition: '', durationPerPixel: 0, bodyImmediately: false };

        let applyStandardModifiers = (obj) => {
          let standardKeys = Object.keys(resetAnimationInfo);
          let keys = Object.keys(obj);
          let info;
          for (let key of standardKeys) {
            if (keys.includes(key)) {
              let value = obj[key];
              let suffix = changeFirstLetter(key);
              obj['collapse' + suffix] = value;
              obj['expand' + suffix] = value;
              delete obj[key];
            }
          }
          return obj;
        };

        animationInfo.update = (changes) => {
          if (changes !== animationInfo) {
            changes = Object.assign({}, changes);
          }

          if (changes.reset) {
            Object.assign(animationInfo, resetAnimationInfo);
          }
          delete changes.reset;

          applyStandardModifiers(animationInfo);

          if (changes.standard) {
            Object.assign(animationInfo, standardAnimationInfo);
          }
          delete changes.standard;

          Object.assign(animationInfo, changes);
          applyStandardModifiers(animationInfo);
        };
      }

      // #endregion Update

    }

    // #endregion Functions


    animationInfo.update(Object.assign({}, animationInfo));
  };
  setAnimationInfo(animationInfo);

  // #endregion Animation Info


  let area = document.createElement('div');
  area.classList.add('collapsable');
  area.classList.add('section');


  let headerArea = document.createElement('div');
  headerArea.classList.add('headerArea');
  headerArea.classList.add('textNotSelectable');
  area.appendChild(headerArea);

  let hoverIndicator = document.createElement('div');
  hoverIndicator.classList.add('hoverIndicator');
  headerArea.appendChild(hoverIndicator);


  let contentWrapper = document.createElement('div');
  contentWrapper.classList.add('contentWrapper');
  area.appendChild(contentWrapper);

  let contentArea = document.createElement('div');
  contentArea.classList.add('contentArea');
  contentWrapper.appendChild(contentArea);


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


  let isCollapsed = true;
  let collapseTimeoutId = null;

  let startCollapseTimeout = (callback, timeInMilliseconds) => {
    if (collapseTimeoutId !== null) {
      clearTimeout(collapseTimeoutId);
    }

    collapseTimeoutId = setTimeout(() => {
      collapseTimeoutId = null;
      callback();
    }, timeInMilliseconds);
  };

  let setCollapsed = (value) => {
    if (isCollapsed === value) {
      return;
    }
    let wasCollapsed = isCollapsed;
    isCollapsed = value;

    let info = animationInfo.getPrefixed(value ? 'collapse' : 'expand');
    let { duration = 0, delay = 0, transition = '', durationPerPixel = 0, bodyImmediately = false } = info;


    if (duration <= 0 && durationPerPixel <= 0) {
      toggleClass(area, 'collapsed', value);
      toggleClass(area, 'open', !value);
      return;
    }


    if (wasCollapsed) {
      toggleClass(area, 'collapsed', true);
    }
    toggleClass(area, 'open', true);


    // Body resizing: 

    let recheckBody = null;
    if (bodyImmediately) {
      if (value || document.body.style.minHeight) {
        document.body.style.minHeight = document.body.offsetHeight + 'px';
      } else {
        let getMinBodyHeight = () => {
          return document.body.scrollHeight - contentWrapper.clientHeight + contentWrapper.scrollHeight;
        };

        let minBodyHeight = getMinBodyHeight();
        document.body.style.minHeight = minBodyHeight + 'px';

        recheckBody = () => {
          let recheckedHeight = getMinBodyHeight();
          if (recheckedHeight === minBodyHeight) {
            return;
          }

          document.documentElement.style.minHeight = minBodyHeight + 'px';

          document.body.style.minHeight = null;
          minBodyHeight = getMinBodyHeight();
          document.body.style.minHeight = minBodyHeight + 'px';
  
          document.documentElement.style.minHeight = null;
        };
      }
    }


    // Apply section animation properties:

    let wantedHeight = contentWrapper.scrollHeight;


    if (durationPerPixel > 0) {
      duration += durationPerPixel * wantedHeight;
    }

    transition = 'max-height ' + duration + 'ms ' + transition;
    if (delay > 0) {
      transition += ' ' + delay + 'ms';
    } else {
      delay = 0;
    }


    contentWrapper.style.transition = transition;
    contentWrapper.style.maxHeight = wantedHeight + 'px';


    // Ensure that max height is applied:
    contentWrapper.clientHeight;

    // Then start height change:
    toggleClass(area, 'collapsed', value);

    // Handle change completed:
    let handleCompleted = () => {
      toggleClass(area, 'open', !value);
      contentWrapper.style.maxHeight = null;
      contentWrapper.style.transition = null;
      document.body.style.minHeight = null;
    };
    let totalAnimationTime = duration + delay;
    let startCompletionHandling = (startDelay = 0) => startCollapseTimeout(handleCompleted, totalAnimationTime - startDelay);

    // Recheck body or wait for completion:
    if (recheckBody) {
      let checkDelay = 20;
      if (checkDelay > totalAnimationTime) {
        checkDelay = totalAnimationTime;
      }
      startCollapseTimeout(() => {
        recheckBody();
        startCompletionHandling(checkDelay);
      }, checkDelay);
    } else {
      startCompletionHandling();
    }
  };
  setCollapsed(isCollapsed);


  let obj = {
    area: area,
    title: headerArea,
    content: contentArea,
  };
  defineProperty(obj, 'isCollapsed', () => isCollapsed, setCollapsed);
  defineProperty(obj, 'animationInfo', () => animationInfo, setAnimationInfo);
  return obj;
}


let gFirstDropDownArea = true;
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
  } else if (gFirstDropDownArea) {
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

    gFirstDropDownArea = false;
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


function createOptionalPermissionArea({ permission, titleMessage, explanationMessage, permissionChangedCallback, onPermissionChanged, requestViaBrowserActionCallback, sectionAnimationInfo = {} } = {}) {
  let obj = {};
  let hasPermission = false;

  let onClick = new EventManager();
  let onHasPermissionChanged = new EventManager();
  onHasPermissionChanged.addListener(permissionChangedCallback);

  let section = createCollapsableArea(sectionAnimationInfo);
  section.area.classList.add('standardFormat');
  section.area.classList.add('permissionController');
  section.title.classList.add('noFontChanges');
  section.title.classList.add('enablable');

  let permissionChanged = (modifiedPermission = false) => {
    toggleClass(section.area, 'granted', hasPermission);
    toggleClass(section.title, 'enabled', hasPermission);

    onHasPermissionChanged.fire(obj, modifiedPermission);
  };


  let manageArea = document.createElement('div');
  manageArea.classList.add('manageArea');
  manageArea.classList.add('preventOpen');
  section.title.appendChild(manageArea);

  let requestButton = document.createElement('button');
  requestButton.classList.add(messagePrefix + 'optionalPermissions_Request');
  manageArea.appendChild(requestButton);

  let removeButton = document.createElement('button');
  removeButton.classList.add(messagePrefix + 'optionalPermissions_Remove');
  manageArea.appendChild(removeButton);


  let permissionHeader = document.createElement('div');
  permissionHeader.classList.add('permissionHeader');
  if (titleMessage) {
    permissionHeader.classList.add(messagePrefix + titleMessage);
  }
  section.title.appendChild(permissionHeader);


  let permissionInfobox = document.createElement('div');
  permissionInfobox.classList.add('permissionInfobox');
  section.title.appendChild(permissionInfobox);

  let infoText = document.createElement('div');
  infoText.classList.add(messagePrefix + 'optionalPermissions_Available');
  permissionInfobox.appendChild(infoText);

  let grantedInfo = document.createElement('div');
  grantedInfo.classList.add('granted');
  grantedInfo.classList.add(messagePrefix + 'optionalPermissions_Granted');
  permissionInfobox.appendChild(grantedInfo);

  let removedInfo = document.createElement('div');
  removedInfo.classList.add('notGranted');
  removedInfo.classList.add(messagePrefix + 'optionalPermissions_NotGranted');
  permissionInfobox.appendChild(removedInfo);


  let explanation = document.createElement('div');
  if (explanationMessage) {
    explanation.classList.add(messagePrefix + explanationMessage);
  }
  explanation.classList.add('textSelectable');
  section.content.appendChild(explanation);


  let start = async () => {
    hasPermission = await browser.permissions.contains(permission);
    permissionChanged();

    let handleButtonClick = async (e) => {
      let wantedState = e.target === requestButton;
      onClick.fire(wantedState);
      checkPermission();
      try {
        let firstAttemptTime = Date.now();
        let attemptWithBrowserAction = false;
        try {
          if (wantedState) {
            let granted = await browser.permissions.request(permission);
          } else {
            let removed = await browser.permissions.remove(permission);
          }
        } catch (error) {
          // Failed to request permission from this page! Try via browser action:
          attemptWithBrowserAction = true;
        }
        if (!attemptWithBrowserAction && wantedState && wantedState !== hasPermission) {
          let attemptDuration = Date.now() - firstAttemptTime;
          if (attemptDuration < 50) {
            attemptWithBrowserAction = true;
          }
        }
        if (attemptWithBrowserAction && requestViaBrowserActionCallback && typeof requestViaBrowserActionCallback === 'function') {
          let operation = requestViaBrowserActionCallback(permission);
          if (operation) {
            let listenerCollection = new DisposableCollection();
            try {
              toggleBrowserActionPrompt(true, e.clientY);
              listenerCollection.trackDisposables([
                new EventListener(document, 'click', async (e) => {
                  requestViaBrowserActionCallback(null);
                }),
              ]);
              await operation;
            } finally {
              toggleBrowserActionPrompt(false);
              listenerCollection.dispose();
            }
          }
        }
      } catch (error) {
        console.log('Failed to modify optional permission!\n', error);
      }

      checkPermission(true);
    };

    requestButton.addEventListener('click', handleButtonClick);
    removeButton.addEventListener('click', handleButtonClick);
  };

  var checkPermission = async (modifiedPermission = false) => {
    let newHasPermission = await browser.permissions.contains(permission);
    if (newHasPermission === hasPermission) {
      return false;
    }
    hasPermission = newHasPermission;
    permissionChanged(modifiedPermission);
    return true;
  };

  if (onPermissionChanged) {
    let permissionChangeListener = new EventListener(onPermissionChanged, () => {
      if (!document.documentElement.contains(obj.area)) {
        permissionChangeListener.close();
        return;
      }
      checkPermission();
    });
  }

  Object.assign(obj, {
    area: section.area,
    section: section,

    onHasPermissionChanged: onHasPermissionChanged.subscriber,
    onClick: onClick.subscriber,

    checkPermission: () => checkPermission(),
    permission: permission,
  });
  defineProperty(obj, 'hasPermission', () => hasPermission);

  obj.start = start();
  return obj;
}

