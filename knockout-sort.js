(function(global, undefined) {
    'use strict';
  
    function StateItem(ko, originalArrayIndex, outputArrayIndex, value, diffProcessor) {
        this.diffProcessor = diffProcessor;
      
        this.originalArrayIndex = originalArrayIndex;
        this.outputArrayIndex = outputArrayIndex;
        this.rawValue = value;
        this.valueComputed = ko.computed(ko.utils.unwrapObservable.bind(undefined, value));
        this.valueComputed.subscribe(this.onValueChanged, this);
        this.value = this.valueComputed.peek();
    }
  
    StateItem.prototype.dispose = function() { 
        this.valueComputed.dispose();
    };
  
    StateItem.prototype.onValueChanged = function(newValue) {
        if (newValue !== this.value) {
            this.diffProcessor([
                {index: this.originalArrayIndex, status: 'deleted'},
                {index: this.originalArrayIndex, status: 'added', value: this.rawValue}
            ]);
        }
    };
                                            
    function processArrayDiff(ko, inputObservableArray, stateArray, outputArray, outputObservableArray, compareFunction, diff) {
        if (!diff.length) {
            return;
        }
          
        var deleteCount = 0;
        var insertCount = 0;
        var lastDeleteIndex = -1;
        var lastDeleteValue = null;
        var lastInsertIndex = -1;
        var lastInsertValue = null;
      
        for (var diffIndex = 0; diffIndex < diff.length; diffIndex++) {
            var diffEntry = diff[diffIndex];
            if (typeof diffEntry.moved === 'number') {
                // Don't care about original order, ignore move events
            } else if (diffEntry.status === 'added') {
                for (var i = 0; i < stateArray.length; i++) {
                    if (stateArray[i].originalArrayIndex >= diffEntry.index) {
                        stateArray[i].originalArrayIndex++;
                    }
                }
                var diffProcessor = processArrayDiff.bind(undefined, ko, inputObservableArray, stateArray, outputArray, outputObservableArray, compareFunction);
                lastInsertIndex = insertSortedStateItem(stateArray, new StateItem(ko, diffEntry.index, -1, diffEntry.value, diffProcessor), outputArray, compareFunction);
                lastInsertValue = diffEntry.value;
                insertCount++;
            } else if (diffEntry.status === 'deleted') {
                for (var j = 0; j < stateArray.length; j++) {
                    if (stateArray[j].originalArrayIndex === diffEntry.index) {
                        lastDeleteIndex = stateArray[j].outputArrayIndex;
                        lastDeleteValue = stateArray[j].rawValue;
                        outputArray.splice(lastDeleteIndex, 1);
                        stateArray[j].dispose();
                        stateArray.splice(j, 1);
                        deleteCount++;
                        j--;
                    } else if (stateArray[j].originalArrayIndex > diffEntry.index) {
                        stateArray[j].originalArrayIndex--;
                    }
                }
                for (var j = 0; j < stateArray.length; j++) {
                    if (stateArray[j].outputArrayIndex > lastDeleteIndex) {
                        stateArray[j].outputArrayIndex--;
                    }
                }
            }
        }

        if (insertCount > 0 || deleteCount > 0) {
            // Special case check: if removed and inserted the same thing in the same spot, ignore
            // This happens whenever an entry's value is updated, but doesn't cause it to be sorted in a new spot
            if (insertCount !== 0 || deleteCount !== 0 || lastInsertIndex !== lastDeleteIndex || lastDeleteValue !== lastInsertValue) {
                outputObservableArray.valueHasMutated();
            } else {
              console.log("Special Ignore!");
            }
        }
    }

    function insertSorted(array, item, compareFunction) {
        var m = Math.floor(array.length / 2), 
            hi = array.length, 
            lo = 0;
      
        if (!compareFunction) {
            compareFunction = function(a, b) {
                if (a > b) {
                    return 1;
                } else if (a < b) {
                    return -1;
                }
                return 0;
            };
        }
      
        do {
            var compare = compareFunction(item, array[m]);
            if (compare > 0) {
                lo = m + 1;
            } else if (compare < 0) {
                hi = m;
            } else {
                break;
            }
        
            m = Math.floor(lo + ((hi - lo) / 2));
        } while (lo < hi);
      
        array.splice(m, 0, item);
        return m;
    }
  
    function insertSortedStateItem(stateArray, stateItem, outputArray, compareFunction) {
        stateItem.outputArrayIndex = insertSorted(outputArray, stateItem.value, compareFunction);
        for (var i = 0; i < stateArray.length; i++) {
            if (stateArray[i].outputArrayIndex >= stateItem.outputArrayIndex) {
                stateArray[i].outputArrayIndex++;
            }
        }
        stateArray.push(stateItem);
        return stateItem.outputArrayIndex;
    }
  
    function observableArraySort(ko, compareFunction) {
        var inputArray = this.peek(),
            inputObservableArray = this,
            stateArray = [],
            outputArray = [],
            outputObservableArray = ko.observableArray(outputArray);
      
        // If the input array changes structurally (items added or removed), update the outputs
        var diffProcessor = processArrayDiff.bind(undefined, ko, inputObservableArray, stateArray, outputArray, outputObservableArray, compareFunction);
        var inputArraySubscription = inputObservableArray.subscribe(diffProcessor, null, 'arrayChange');

        // Build output by inserting each item in its sorted position
        for (var i = 0; i < inputArray.length; i++) {
            insertSortedStateItem(stateArray, new StateItem(ko, i, -1, inputArray[i], diffProcessor), outputArray, compareFunction);
        }
      
        // Return value is a readonly computed which can track its own changes to permit chaining.
        // When disposed, it cleans up everything it created.
        var returnValue = ko.computed(outputObservableArray).extend({ trackArrayChanges: true }),
            originalDispose = returnValue.dispose;
        returnValue.dispose = function() {
            inputArraySubscription.dispose();
            ko.utils.arrayForEach(stateArray, function(stateItem) {
                stateItem.dispose();
            });
            originalDispose.call(this, arguments);
        };

        // Make projections chainable
        addProjectionFunctions(ko, returnValue);

        return returnValue;
    }

    // Attaching projection functions
    // ------------------------------
    //
    // Builds a collection of projection functions that can quickly be attached to any object.
    // The functions are predefined to retain 'this' and prefix the arguments list with the
    // relevant 'ko' instance.

    var projectionFunctionsCacheName = '_ko.projections.cache';

    function attachProjectionFunctionsCache(ko) {
        // Wraps callback so that, when invoked, its arguments list is prefixed by 'ko' and 'this' 
        function makeCaller(ko, callback) {
            return function() {
                return callback.apply(this, [ko].concat(Array.prototype.slice.call(arguments, 0)));
            };
        }
        ko[projectionFunctionsCacheName] = {
            sort: makeCaller(ko, observableArraySort)
        };
    }

    function addProjectionFunctions(ko, target) {
        ko.utils.extend(target, ko[projectionFunctionsCacheName]);
        return target; // Enable chaining
    }

    // Module initialisation
    // ---------------------
    //
    // When this script is first evaluated, it works out what kind of module loading scenario
    // it is in (Node.js or a browser `<script>` tag), and then attaches itself to whichever
    // instance of Knockout.js it can find.

    function attachToKo(ko) {
        attachProjectionFunctionsCache(ko);
        addProjectionFunctions(ko, ko.observableArray.fn); // Make all observable arrays projectable
    }

    // Determines which module loading scenario we're in, grabs dependencies, and attaches to KO
    function prepareExports() {
        if (typeof module !== 'undefined') {
            // Node.js case - load KO synchronously
            var ko = require('knockout');
            attachToKo(ko);
            module.exports = ko;
        } else if ('ko' in global) {
            // Non-module case - attach to the global instance
            attachToKo(global.ko);
        } else if (typeof define === 'function' && define.amd) {
            require(['knockout'], function(ko) {
                attachToKo(ko);
            });
        }
    }

    prepareExports();

})(this);