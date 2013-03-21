var child_process = require('child_process');
var D = require('./D.js');

var exec = D.nodeStyle(child_process.exec);

var p  = exec('ls -l')
    .apply(
        function(stdin,stdout){
            console.log('OK');
            console.log(arguments);
        }
        ,function(err){
            console.log('ERROR');
            console.log(arguments);
        }
    )
    .rethrow()
;

