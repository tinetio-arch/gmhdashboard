/**
 * GraphQL Schema Definition
 * This defines what data you can query and how
 */

import { GraphQLObjectType, GraphQLSchema, GraphQLString, GraphQLInt, GraphQLFloat, GraphQLList, GraphQLNonNull, GraphQLID } from 'graphql';

// Example: Patient Type
const PatientType = new GraphQLObjectType({
  name: 'Patient',
  fields: () => ({
    id: { type: GraphQLID },
    name: { type: GraphQLString },
    email: { type: GraphQLString },
    phone: { type: GraphQLString },
    status: { type: GraphQLString },
    // Add more fields as needed
  }),
});

// Example: Payment Type (from Stripe)
const PaymentType = new GraphQLObjectType({
  name: 'Payment',
  fields: () => ({
    id: { type: GraphQLID },
    amount: { type: GraphQLFloat },
    status: { type: GraphQLString },
    date: { type: GraphQLString },
  }),
});

// Example: Subscription Type (from Healthie)
const SubscriptionType = new GraphQLObjectType({
  name: 'Subscription',
  fields: () => ({
    id: { type: GraphQLID },
    packageName: { type: GraphQLString },
    amount: { type: GraphQLFloat },
    status: { type: GraphQLString },
    nextChargeDate: { type: GraphQLString },
  }),
});

// Root Query - This is what you can ask for
const RootQuery = new GraphQLObjectType({
  name: 'RootQueryType',
  fields: {
    // Get a single patient with all their data
    patient: {
      type: PatientType,
      args: {
        id: { type: GraphQLNonNull(GraphQLID) },
      },
      resolve: async (parent, args, context) => {
        // This will fetch from your database
        // We'll implement this next
        return null;
      },
    },
    
    // Get all patients
    patients: {
      type: GraphQLList(PatientType),
      resolve: async (parent, args, context) => {
        // Fetch all patients
        return [];
      },
    },
    
    // Get patient with payments and subscriptions (all in one query!)
    patientComplete: {
      type: new GraphQLObjectType({
        name: 'PatientComplete',
        fields: () => ({
          patient: { type: PatientType },
          payments: { type: GraphQLList(PaymentType) },
          subscriptions: { type: GraphQLList(SubscriptionType) },
        }),
      }),
      args: {
        id: { type: GraphQLNonNull(GraphQLID) },
      },
      resolve: async (parent, args, context) => {
        // Fetch patient + payments + subscriptions all at once
        return {
          patient: null,
          payments: [],
          subscriptions: [],
        };
      },
    },
  },
});

// Create the schema
export const schema = new GraphQLSchema({
  query: RootQuery,
  // mutations: ... (for creating/updating data)
});


