var child_process = require('child_process')
	, fs = require('fs')
	, D = require('./D.js')
    , DEBUG_MODE = false
    , log = function(){
        if( typeof(DEBUG_MODE) !== 'undefined' && DEBUG_MODE ){
            return console.log.apply(console,arguments);
        }
    }
;
// promisify some node functions
var exec = D.nodeStyle(child_process.exec);
var readFile = D.nodeStyle(fs.readFile);

//first read config file
var repoConfig=JSON.parse(fs.readFileSync('./repositories-config.json'));
var repoStatus={};

function parseBranches(str){
    var res=[];
	str.replace(
        /(?:Merge branch(?:es)?|,|and)\s+?'([^']+)'\s*(?=,|and |into testing)/g // @todo this should use repoConfig.testing value
        ,function(m,branch){ res.push(branch);}
    );
    log('\nPARSEBRANCHES:\n',str,res,'\n');
	return res;
}
function updateRepoStatus(){
	var promises=[];
	for( var repo in repoConfig ){
		repoStatus[repo] = {merges:[]};
        (function(repo,conf){
            promises.push(
                //~ exec('git remote update',{cwd:conf.path})
                exec('pwd',{cwd:conf.path})
                    .then(function(){
                        return exec('git log --merges '+conf.upstream+'/'+conf.prod+'..'+conf.upstream+'/'+conf.testing+' --pretty="%cn#%ci#%s"',{cwd:conf.path});
                    })
                    .apply(function(stdout,stderr){
                        log('\nSTART '+repo+'\n',stdout,repoStatus,'\n---------------------------\n');
                        stdout.replace(/^([^#]+)#([^#]+)#([^\n]+)/mg,function(m,by,date,branches){
                            log('FEEDING '+repo+'\n with:'+stdout+'\n',branches,'\n');
                            repoStatus[repo].merges.push({
                                by:by
                                ,at:date
                                ,branches:parseBranches(branches)
                            });
                        });
                        repoStatus[repo].merges.sort(function(a,b){ return a.at > b.at ? -1 : (a.at===b.at?0:1);});
                    })
                    .rethrow(function(err){
                        repoStatus[repo].error = err.toString();
                    })
            );
		})(repo,repoConfig[repo]);
	}
	return D.all(promises);
}

updateRepoStatus()
	.then(function(){
		console.log(JSON.stringify(repoStatus));
	});
return;
