
var child_process = require('child_process')
	, fs = require('fs')
	, gravatar = require('gravatar')
	, http = require('http')
	, D = require('./D.js')
	, DEBUG_MODE = false
	, log = function(){
		if( typeof(DEBUG_MODE) !== 'undefined' && DEBUG_MODE ){
			console.log.apply(console,arguments);
		}
	}
;

// promisify some node functions
var exec = D.nodeCapsule(child_process.exec)
	, readFile = D.nodeCapsule(fs.readFile)
	, readCachedFile = function(file){
		if (DEBUG_MODE) {
			return readFile(file);
		}
		var d=D();
		if (readCachedFile.cached && readCachedFile.cached[file]) {
			d.resolve(readCachedFile.cached[file]);
		} else {
			readFile(file).then(function(data){ d.resolve(readCachedFile.cached[file] = data);console.log(data)},d.reject).rethrow();
		}
		return d.promise;
	}
;

/**
* exec a command on the given repo
* @param string repoName
* @param string cmd will replace placeHolders %prod %feature %upstream by their corresponding config value
* @param bool remoteUpdateFirst
* @return a promise
*/
function repoExec(repoName,cmd,remoteUpdateFirst){
	if( repoConfig === null ){ // enforce a config is already read
		return updateConfig().then(function(){ return repoExec(repoName,cmd,remoteUpdateFirst);});
	}
	var conf = repoConfig[repoName];
	if( undefined === conf ){
		return reject('invalid repoName ' + repoName);
	}
	var cmdOpts = {cwd:conf.path}
		,statusPromise
	;
	cmd = cmd.replace(/%(prod|feature|upstream)/g,function(m,key){
		return conf[key];
	});
	if( remoteUpdateFirst ){
		statusPromise=exec('git remote update --prune',cmdOpts).then(function(){ return exec(cmd,cmdOpts);});
	}else{
		statusPromise=exec(cmd,cmdOpts);
	}
	if( DEBUG_MODE ){
		return statusPromise
			.apply(
				function(stdout,stderr){
					log('[repoExec:'+repoName+']',cmd,'\n'+stdout,stderr);
					return [stdout,stderr];
				}
				,function(Err){
					log('[repoExec:'+repoName+' ERROR]',Err,cmd);
					throw Err;
				}
			)
		;
	}
	return statusPromise;
}

/**
* shorthand to return a rejected promise with given error
*/
function reject(err){
	var d = D();
	d.reject(err);
	return d.promise;
}

readCachedFile.cached = {};

//first read config file
var repoConfig=null
	, repoStatuses={}
;

/**
* return a promise of updated config read
* @return promise
*/
function updateConfig(){
	var d=D();
	readFile('./repositories-config.json',{encoding:'utf8'})
		.then(function(data){ var tmp = JSON.parse(data.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g,'')); repoConfig = tmp; d.resolve(true);})
		.rethrow(function(err){d.reject(err);log(err);})
		//.then(function(){console.log('LOG',arguments)})
	;
	return d.promise;
}

/**
* parse branches part of the log and return a  list of branches as an array
* @param string log part containing the branches
* @param object repoConfig the configuration matching the repository
* @return Array
*/
function parseBranches(str,repoConfig){
	var res=[]
		,exp=new RegExp("(?:Merge(?: remotes?)? branch(?:es)?|,|and)\\s+?'([^']+)'\\s*(?=,|and |into "+repoConfig.feature+")",'g')
		,originExp=new RegExp("^"+repoConfig.upstream+"/")
		,excludeExp=new RegExp("^.*branch '"+repoConfig.feature+"' of.*$",'mg')
	;
	str
		.replace(excludeExp,function(m){ res.push({name:'<b style="color:red">'+m+'</b>'});})
		.replace(exp, function(m,branch){ res.push({name:branch.replace(originExp,'')});})
	;
	return res;
}
/**
* check for a branch if all commits are properly applieds or not
* @param string repoName
* @param string branchName
* @param string againstBranch (may be %feature or %prod)
* @param bool remoteUpdateFirst
* @return promise of result
*/
function checkBranchStatus(repoName,branch,againstBranch,remoteUpdateFirst){
	var cmd = 'git branch -r | grep "%upstream/\\('+branch+'\\|'+againstBranch+'\\)" > /dev/null && git cherry --abbrev -v %upstream/'+againstBranch+' %upstream/'+branch;
	return repoExec(repoName,cmd,remoteUpdateFirst)
		.apply(function(stdout,stderr){
			if( stdout.match(/^\+/m) ){
				return stdout.replace(/^[^\+].*\n/gm,'').replace(/^\s+|\s+$/g,'');
			}
			return '';
		})
		.error(function(Err){
			log('Error ', Err);
		})
	;
}
/**
* update a single repository status
* @param string repoName
* @param bool remoteUpdateFirst
* @return promise of object repoStatus
*/
function updateRepoStatus(repoName,remoteUpdateFirst){
	var cmd ='git log --merges %upstream/%prod..%upstream/%feature --pretty="%cn#%ce#%ct#%s"' // | grep "into %feature"';
	return repoExec(repoName,cmd,remoteUpdateFirst)
		.apply(function(stdout,stderr){
			// initialize repoStatus[repoName]
			repoStatuses[repoName] = {name:repoName,label:repoConfig[repoName].label,updateTime:(new Date()).getTime(),merges:[],branches:[]};
			stdout.replace(/^([^#]+)#([^#]+)#([^#]+)#([^\n]+)/mg,function(m,by,mail,date,branches){
				repoStatuses[repoName].merges.push({
					by:by
					,mail:mail
					,gravatar:gravatar.url(mail,{s:32,d:'wavatar'},false)
					,at:date*1000
					,branches:parseBranches(branches,repoConfig[repoName])
				});
			});
			repoStatuses[repoName].merges.sort(function(a,b){ return a.at > b.at ? -1 : (a.at===b.at?0:1);});
		})
		.error(function(err){
			repoStatuses[repoName] = {name:repoName,label:repoConfig[repoName].label,updateTime:(new Date()).getTime(),error:err.toString()};
		})
		.success(function(){
			return getBranches(repoName,false);
		})
		.then(function(){ return repoStatuses[repoName];})
	;
}

/**
* update all repositories statuses
* @param bool remoteUpdateFirst
* @return promise of object repoStatuses
*/
function updateRepoStatuses(remoteUpdateFirst){
log('updating')
	var promises=[];
	for( var repo in repoConfig ){
		promises.push(updateRepoStatus(repo,remoteUpdateFirst));
	}
	return D.all(promises);
}

/**
* return list of branch for given project
* @param repoName
*/
function getBranches(repoName,remoteUpdateFirst){
	if(! repoConfig[repoName]){
		return D.rejected('Invalid repoName');
	}
	var rejectBranchExp = new RegExp(repoConfig[repoName].prod+'|'+repoConfig[repoName].feature+'|HEAD\\s+->');
	return repoExec(repoName,'git branch -r',remoteUpdateFirst)
		.apply(function(stdout,stderr){
			repoStatuses[repoName].branches = [];
			if( stderr ){
				return D.rejected(stderr);
			}
			var promises = [];
			stdout.replace(new RegExp('^\\s*'+repoConfig[repoName].upstream+'/(.*)$','mg'),function(m,branch){
				if( branch.match(rejectBranchExp) ){
					return;
				}
				var branchDef = {
					name:branch
					,featureStatus:[]
					,prodStatus:[]
				};
				promises.push(
					D.all( // get unintegrated commits
						checkBranchStatus(repoName,branch,'%feature')
							.success(function(commits){commits && (branchDef.featureStatus = commits.split('\n'));})
						,checkBranchStatus(repoName,branch,'%prod')
							.success(function(commits){commits && (branchDef.prodStatus = commits.split('\n'));})
					)
					.success(function(){ // append branchDef status to repoStatuses when filled
						return repoStatuses[repoName].branches.push(branchDef);
					})
				);
			});
			return D.all(promises);
		})
		.success(function(){
			return repoStatuses[repoName].branches;
		})
	;
}
// starting the server
updateConfig()
	.then(function(){ updateRepoStatuses(false) })
	.then(function(){
		log('create server',repoConfig)
		http.createServer(function (req, res) {
			//res.writeHead(200, {'Content-Type': 'application/json'});
			//log('requesting '+req.url,req.headers);
			var query = req.url.substr(1).split('/')
				,action = query[0]
				,params = query.slice(1)
				,content = null
			;
			switch(action){
				//~ case 'gravatar':
					//~ content = D.promisify(params[0] ? gravatar.url(params[0], {s: '64'}, false) : null);
					//~ break;
				case 'favicon.ico':
					content = D.rejected(410);
					break;
				case 'D.js':
					content = readCachedFile('./D.js');
					break;
				case 'getStatuses':
					content = (params[0] === 'reload') ? updateRepoStatuses(true).success(function(){ return repoStatuses;}) : repoStatuses;
					break;
				case 'updateConfig':
					updateConfig();
					content = 'done';
					break;
				case 'getBranches':
					content = getBranches(params[0]);
					break;
				case 'getStatus':
					content = updateRepoStatus(params[0],true);//.success(function(){return repoStatuses[params[0]];});
					break;
				case 'serverTime':
					content = (new Date()).getTime()+'';
					break;
				case 'webfonts':
					action = 'webfonts/'+params.join('/').replace(/\?.*$/,'');
					content = readFile('public/'+action);
					break;
				case 'branchInfos':
					content = checkBranchStatus(params[0],params[1],'%feature',false)
						.success(function(res){
							return res==='' ? 'All commits appeares to be merged' : res;
						});
					break;
				default:
					if( action.match(/^(|index(?:\.html)?|(?:basic-compat|stpl)\.js)$/) ){
						( action ==='' || req.url==='index' ) &&  (action = '/index.html');
						content = readCachedFile('public/'+action);
					}
					break;
			}
			// ensure content is a promise
			if(! (content && content.then) ){
				var d = D();
				d.resolve(content);
				content = d.promise;
			}
			//log('WAITING RESOLVE',action,content);
			content
				.then(
					function(body){
						//console.log('response',action,params,typeof body,body instanceof Buffer);
						if( ! body ){
							throw new Error(404);
						}
						if( typeof body === 'string' || (body instanceof Buffer) ){
							action.replace(/\.(js|css|html|htm)$/,function(m,ext){
								var ctype='text/plain';
								(ext==='css') && (ctype='text/css');
								(ext==='js') && (ctype='application/javascript');
								(ext==='html'||ext==='htm') && (ctype='text/html');
								(ext==='manifest') && (ctype='text/cache-manifest');
								(ext==='woff') && (ctype='application/x-font-woff');
									res.setHeader("Content-Type",ctype);
								var expDate = new Date();
								if( ext.match(/^(css|js|manifest|woff|html?)$/)){
									expDate.setTime(expDate.getTime()+600000);
								}else if( ext.match(/^json$/) ){
									expDate.setTime(expDate.getTime()-6000);
								}else{
									expDate.setTime(expDate.getTime()+60000);
								}
								res.setHeader('Expires',expDate.toUTCString());
							});
							res.writeHead(200);
							res.write(body);
							res.end();
						}else{
							res.writeHead(200, {'Content-Type': 'application/json'});
							res.end(JSON.stringify(body));
						}
					}
					,function(Err){
						res.writeHead(404, {'Content-Type': 'text/html'});
						res.end('<h1>404</h1> Page unknown\n<br />'+Err);
					}
				)
				.error(function(err){
					console.log('ERROR>>',err,'<<ERROR')
					res.writeHead(typeof err === 'number' ? err : 500, {"Content-Type": "text/plain"});
					res.write((typeof err !== 'number' ? err : 'Internal Server Error' ) + "\n");
					res.end();
				})
			;
		}).listen( process.argv[3] || 8000, process.argv[2] || '127.0.0.1' );
	})
	.rethrow()
;
