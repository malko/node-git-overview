var child_process = require('child_process')
	, fs = require('fs')
	, D = require('./D.js')
;
// promisify some node functions
var exec = D.nodeStyle(child_process.exec);
var readFile = D.nodeStyle(fs.readFile);

//first read config file
var repoConfig=JSON.parse(fs.readFileSync('./repositories-config.json'));
var repoStatus={};

function parseBranches(str){
	var res=[];
	str.replace(/(?:Merge branch(?:es)?|,|and)\s+?'([^']+)'\s*(?:,|and |into testing)/,function(m,branch){ res.push(branch);})
	return res;
}
function updateRepoStatus(){
	var promises=[],c;
	for( var repo in repoConfig ){
		c=repoConfig[repo];
		promises.push(
			exec('git log --merges '+c.upstream+'/'+c.prod+' '+c.testing+' --pretty="%cn#%ci#%s"',{cwd:c.path})
				.apply(function(stdout,stderr){
					repoStatus[repo] = {merges:[]};
					stdout.replace(/^([^#]+)#([^#]+)#([^\n]+)/g,function(m,by,date,branches){
						repoStatus[repo].merges.push({
							by:by
							,at:date
							,branches:parseBranches(branches)
						});
					});
					repoStatus[repo].merges.sort(function(a,b){ return a.at > b.at ? 1 : (a.at===b.at?0:-1);});
				})
				.rethrow(function(err){
					repoStatus[repo].error = err.toString();
				})
		);
	}
	return D.all(promises);
}

updateRepoStatus()
	.then(function(){
		console.log(JSON.stringify(repoStatus));
	});
return;
