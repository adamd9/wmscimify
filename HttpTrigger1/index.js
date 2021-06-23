module.exports = async function (context, req) {
    context.log('JavaScript HTTP trigger function processed a request.');
    context.log(req);

    //process.env["functiontoken"] represents your own secret you'll use to secure the function
    //Beyond deploying this function, you'll need to enable it for Azure AD identiy management so it can access protected resources
    //You'll need to set up a Key Vault with a functiontoken secret, assign an access policy that includes your Azure function as the service principal and get/list permissions for secrets
    //See here for some instructions https://daniel-krzyczkowski.github.io/Integrate-Key-Vault-Secrets-With-Azure-Functions/

    if (req.headers.authorization === 'Bearer ' + process.env["functiontoken"]) {
        context.log("Bearer token accepted");
    } else {
        context.log("Empty or invalid bearer token");
        context.res.status = 401;
        return;
    }

    const axios = require("axios")
    var qs = require('qs');
    var data = qs.stringify({
      'grant_type': 'client_credentials' 
    });

    //process.env["wmcredentials"] represents the WalkMe API credentials provided by Walkme (client ID and client secret base 64 encoded as described in https://developer.walkme.com/reference#getting-started-with-your-api-1)
    //Beyond deploying this function, you'll need to enable it for Azure AD identiy management so it can access protected resources
    //You'll need to set up a Key Vault with a wmcredentials secret, assign an access policy that includes your Azure function as the service principal and get/list permissions for secrets

    const options = {
        headers: { 
            'Authorization': 'Basic ' + process.env["wmcredentials"], 
            'Content-Type': 'application/x-www-form-urlencoded'
        }
      };

    var token_req = await axios.post('https://api.walkme.com/accounts/connect/token', data, options).then(function(response) {
        return response.data;
        }).catch(function(error) {
            return error.response.data;
        });

    auth_token = token_req.access_token;


    //get access roles
        context.log('Getting access roles');
        const options1 = {headers: {'Authorization': 'Bearer ' + auth_token}};
        const access_roles = await axios.get('https://api.walkme.com/public/v1/scim/AccessRoles', options1).then(function(response) {
            return response.data;
            }).catch(function(error) {
                return error.response.data;
            });

    //get all users
    if (req.method === "GET" && Object.keys(req.query).length === 0 && Object.keys(req.params).length === 0) {
        context.log('Is get all users');
        const options1 = {headers: {'Authorization': 'Bearer ' + auth_token}};
        var users_req = await axios.get('https://api.walkme.com/public/v1/scim/Users', options1).then(function(response) {
            return response.data;
            }).catch(function(error) {
                return error.response.data;
        });

        for (const i in users_req.Resources) {
            var humanRoleName = access_roles.Resources.filter(item => item.id === users_req.Resources[i].accessRole).map(item => item.name);
            users_req.Resources[i].accessRoleDisplayName = humanRoleName[0];
        }
        responseMessage = users_req;
    
    };

    //get user by ID
    if (req.method === "GET" && req.params.user_id) {
        context.log('Is get user by ID');
        const options1 = {headers: {'Authorization': 'Bearer ' + auth_token}};
        var users_req = await axios.get('https://api.walkme.com/public/v1/scim/Users/' + req.params.user_id, options1).then(function(response) {
            // if (response.data.allowedSystems.length === 0) {response.data.active = "False"} else {response.data.active = "True"};
            return response.data;
            }).catch(function(error) {
                if (error.response.data.status === 404) {
                    error.response.data.detail = 'Resource ' + req.params.user_id + ' not found';
                }
                return error.response.data;
            });

        var humanRoleName = access_roles.Resources.filter(item => item.id === users_req.accessRole).map(item => item.name);
        users_req.accessRoleDisplayName = humanRoleName[0];
        responseMessage = users_req;
    
    };    

    //get users by filter
    if (req.method === "GET" && req.query.filter) {
        context.log('Is get users by filter: ' + req.query.filter);
        const options1 = {headers: {'Authorization': 'Bearer ' + auth_token}};
        var users_req = await axios.get('https://api.walkme.com/public/v1/scim/Users', options1).then(function(response) {
            context.log(JSON.stringify(response.data))
            return response.data;
            }).catch(function(error) {
                return error.response.data;
        });
        
        var filterUserString = req.query.filter.match(/userName.eq.\"(.*)\"/);
        var filtered = users_req.Resources.filter(a => a.userName.includes(filterUserString[1]));
        users_req.totalResults = filtered.length;
        users_req.Resources = filtered;
        for (const i in users_req.Resources) {
            var humanRoleName = access_roles.Resources.filter(item => item.id === users_req.Resources[i].accessRole).map(item => item.name);
            users_req.Resources[i].accessRoleDisplayName = humanRoleName[0];
        }
        //TODO - change to a loop incase multiple results
        // if (users_req.Resources.length === 1) {
        //     if (users_req.Resources[0].allowedSystems.length === 0) {
        //         users_req.Resources[0].active = "False"
        //     } else {
        //         users_req.Resources[0].active = "True"
        //     };
        // };

        responseMessage = users_req;
    
    };

    //Create user
    if (req.method === "POST") {
        context.log('Is create user request');

        var accessRoleId = access_roles.Resources.filter(item => item.name === req.body.accessRoleDisplayName).map(item => item.id);
        req.body.accessRole = accessRoleId[0];

        //So there should be no need to set a password because the WalkMe spec doesn't require it, but apparently it does.
        //While the password should not really matter as the account will be authenticated via SAML, just making it pseudo-random to be safe.
        const Crypto = require('crypto');
        req.body['password'] = "Scim@2021!" + Crypto
            .randomBytes(21)
            .toString('hex')
            .slice(0, 21);

        const options1 = {headers: {'Authorization': 'Bearer ' + auth_token}};
        var users_req = await axios.post('https://api.walkme.com/public/v1/scim/Users', req.body, options1).then(function(response) {
            //context.log(JSON.stringify(response.data))
            return response.data;
            }).catch(function(error) {
                return error.response.data;
        });
        
        responseMessage = users_req;
    };

    //Update user
    if (req.method === "PATCH") {
        context.log('Is update user request');
        
        const putreq = {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
            name: {}
        };

        for (const i in req.body.Operations) {
            if (req.body.Operations[i].path === 'name.givenName') {putreq.name.givenName = req.body.Operations[i].value};
            if (req.body.Operations[i].path === 'name.familyName') {putreq.name.familyName = req.body.Operations[i].value};
            if (req.body.Operations[i].path === 'externalId') {putreq.externalId = req.body.Operations[i].value};
            if (req.body.Operations[i].path === 'userName') {putreq.userName = req.body.Operations[i].value};
            if (req.body.Operations[i].path === 'accessRoleDisplayName') {
                var accessRoleId = access_roles.Resources.filter(item => item.name === req.body.Operations[i].value).map(item => item.id);
                putreq.accessRole = accessRoleId[0];
            };

            if (req.body.Operations[i].path === 'active' && req.body.Operations[i].value === 'False') {
                //AAD marks for soft deletion then performs a DELETE request 30 days later. As there is no active marker, removing all systems and marking the name for deletion.
                putreq.name.givenName = "AAD MARKED FOR DELETION";
                putreq.name.familyName = "AAD MARKED FOR DELETION";
                putreq.allowedSystems = [""];
            };

          }

        const options1 = {headers: {'Authorization': 'Bearer ' + auth_token}};
        var users_req = await axios.put('https://api.walkme.com/public/v1/scim/Users/' + req.params.user_id, putreq, options1).then(function(response) {
            // if (response.data.allowedSystems.length === 0) {response.data.active = "False"} else {response.data.active = "True"};
            return response.data;
            }).catch(function(error) {
                return error.response.data;
        });
        
        responseMessage = users_req;
    };

    //Delete user
    if (req.method === "DELETE") {
        context.log('Is delete user request');
        context.log(req);
        const options1 = {headers: {'Authorization': 'Bearer ' + auth_token}};
        var users_req = await axios.delete('https://api.walkme.com/public/v1/scim/Users + req.params.user_id', options1).then(function(response) {
            //context.log(JSON.stringify(response.data))
            return response.data;
            }).catch(function(error) {
                return error.response.data;
        });
        
        responseMessage = users_req;
    };
    context.log(responseMessage);
    context.res = {
        // status: 200, /* Defaults to 200 */
        body: responseMessage
    };

}