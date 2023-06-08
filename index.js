const admin = require("firebase-admin");
const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const app = express();

const DB_UPDATE_FREQ_IN_MILLISECONDS = 5 * 60 * 1000; // set to 5 mins

//						days hours minutes seconds milliseconds
const MILLISECONDS_IN_WEEK = 7 * 24 * 60 * 60 * 1000;
const MILLISECONDS_IN_DAY = 1 * 24 *  60 * 60 * 1000;

app.use(bodyParser.json());

// Initialize the app with your service account credentials
const serviceAccount = require("./service-account-key.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "data-base-url"
});

// send post requests to this endpoint
const API_ENDPOINT = "/v1/company-name-api/send"; // listens to HTTP POST requests 'only'

// incoming request.body will be in this form
let msg = {
	email: '',
	token: '',
	date: '',
	product: '',
	quantity: ''
};

function HTTP_POST_REQUEST_TO_FIREBASE(msg_title, msg_body, msg_to)
{
	// construct the header of the request to be made
	// defined here as it's constant for any future requests
	const server_key = "server-key";
	const headers = {
		"Authorization": "Bearer " + server_key,
		"Content-Type": "application/json"
	};
	
	// construct the body of the POST request
	const body = {
		to: msg_to,
		notification: {
			title: msg_title,
			body: msg_body,
			mutable_content: true
		},
		data: {
			channel_id: "heads-up"
		}
	}
	
	// then forward the notification to firebase
	axios.post('https://fcm.googleapis.com/fcm/send', body, {headers})
	.then(response => console.log(JSON.stringify(response.data, null, 2)))
	.catch(error => console.error("ERROR:" + error));
}

// Get a database reference
const db = admin.firestore();

const usersRef = db.collection('users');

var myUsers = []

async function get_users_from_firebase()
{
	myUsers = []
	
	usersSnapshot = await usersRef.get();
	
	if (!usersSnapshot.empty)
	{
		console.log("saving users");
		return usersSnapshot.docs.map((doc) => doc.data());
	}
	else
		console.log("db is empty");
}

async function get_users()
{
	myUsers = await get_users_from_firebase();
	console.log(myUsers);
	console.log(`myUsers.length: ${myUsers.length}`);
	return true;
}

async function INIT_SERVER()
{
	getUsersSuccessful = await get_users();
	
	if(getUsersSuccessful)
	{
		notifySuccessful = await notify_users_on_product_dates();
		if (notifySuccessful)
		{
			console.log("SERVER INITIALIZED SUCCESSFULLY");
		}
	}
	else
	{
		console.log("COULDN'T RETRIEVE USER DATA\nTERMINATING SERVER...");
		process.exit(-1);
	}
	
}

INIT_SERVER();

// NOTIFICATION TYPE 1: THIS NOTIFIES USERS ABOUT WHAT'S BEEN BOUGHT TO THE HOUSE
// handle the POST request within the callback
app.post(API_ENDPOINT, (req, res) => {
	// assign the req.body.json to js object
	msg = req.body;
	currentUser = null;
	
	console.log(`my users: ${myUsers}`);
	
	for (let i=0; i<myUsers.length; i++)
	{
		if (myUsers[i].email == msg.email)
		{
			currentUser = myUsers[i];
			console.log("user found!");
			break;
		}
	}

	if (currentUser == null)
	{
		console.log("user not found");
		return;
	}
	
	currentUser.tokens.forEach((token) => {
		// exclude the sender from the ones that are to be notified
		if (token == msg.token)
		{
			let message_title = "Yeni Ürün!";
			let message_body = `Eve en son ${msg.date} tarihinde ${msg.quantity} ${msg.product} alındı.`;
			HTTP_POST_REQUEST_TO_FIREBASE(message_title, message_body, token);
			console.log(`notification sent to ${token}`);
		}
	});
});

// NOTIFICATION TYPE 2: THIS NOTIFIES USERS ABOUT THE DECAYING PRODUCTS
// this function is called every 24h
async function notify_users_on_product_dates()
{
	
	// find the date of now in istanbul
	let now = new Date();
	let options = { timeZone: 'Europe/Istanbul'};
	let timeString = now.toLocaleString('en-US', options);
	let nowInIstanbul = new Date(Date.parse(timeString));
	
	// for each user
	myUsers.forEach((user) => {
		// products that will be expired in 7 days
		productsToBeExpired = []
		
		if (user.hasOwnProperty('buyed_products'))
		{
			// for each product
			user.buyed_products.forEach((product) => {
				// check if product will be expired in 7 days
				let expirationString = product.product_date;
				let expirationDateLocal = new Date(Date.parse(expirationString));
				let options = { timeZone: 'Europe/Istanbul' };
				let expirationStringInIstanbul = expirationDateLocal.toLocaleString('en-US', options);
				let expirationDateInIstanbul = new Date(Date.parse(expirationStringInIstanbul));
				
				// rounded to upper bound
				let daysLeftTillExpiration = Math.ceil((expirationDateInIstanbul - nowInIstanbul) / MILLISECONDS_IN_DAY);
				
				// if a week is left till the expiration
				if (daysLeftTillExpiration <= 7)
				{
					productsToBeExpired.push(product.product_name);
				}
			});
		}

		if (productsToBeExpired.length != 0)
		{
			message_title = "Son kullanma tarihi yaklaşan ürünler var!";
			message_body = `Şu ürünlerin tarihinin geçmesine 1 haftadan az kaldı: ${productsToBeExpired.join(", ")}`;
			
			// send to all tokens
			if (user.hasOwnProperty('tokens'))
			{
				user.tokens.forEach((message_to) => {
					HTTP_POST_REQUEST_TO_FIREBASE(message_title, message_body, message_to);
				});
				
				return true;
			}
			else
			{
				console.log("ERROR SENDING NOTIFICATIONS !\nTERMINATING SERVER...");
				process.exit(-1);
			}
		}
	});
}

setInterval(get_users, DB_UPDATE_FREQ_IN_MILLISECONDS);
setInterval(notify_users_on_product_dates, MILLISECONDS_IN_DAY);


app.listen(3000, () => {
	console.log('Server started on port 3000');
});