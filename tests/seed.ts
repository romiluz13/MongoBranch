/**
 * Realistic seed data for MongoBranch tests.
 * NO MOCKS — this data gets inserted into a real MongoDB instance.
 */
import { ObjectId } from "mongodb";

export const SEED_DATABASE = "ecommerce_app";

export const SEED_USERS = [
  {
    _id: new ObjectId("507f1f77bcf86cd799439011"),
    name: "Alice Chen",
    email: "alice.chen@techcorp.io",
    role: "admin",
    department: "Engineering",
    hireDate: new Date("2023-01-15"),
    salary: 145000,
    skills: ["TypeScript", "MongoDB", "React"],
    address: { city: "San Francisco", state: "CA", zip: "94105" },
    active: true,
  },
  {
    _id: new ObjectId("507f1f77bcf86cd799439012"),
    name: "Bob Martinez",
    email: "bob.martinez@techcorp.io",
    role: "developer",
    department: "Engineering",
    hireDate: new Date("2023-06-01"),
    salary: 120000,
    skills: ["Python", "PostgreSQL", "FastAPI"],
    address: { city: "Austin", state: "TX", zip: "73301" },
    active: true,
  },
  {
    _id: new ObjectId("507f1f77bcf86cd799439013"),
    name: "Carol Nakamura",
    email: "carol.nakamura@techcorp.io",
    role: "designer",
    department: "Product",
    hireDate: new Date("2022-11-20"),
    salary: 110000,
    skills: ["Figma", "CSS", "Design Systems"],
    address: { city: "Seattle", state: "WA", zip: "98101" },
    active: true,
  },
  {
    _id: new ObjectId("507f1f77bcf86cd799439014"),
    name: "David Okonkwo",
    email: "david.okonkwo@techcorp.io",
    role: "developer",
    department: "Engineering",
    hireDate: new Date("2024-02-10"),
    salary: 130000,
    skills: ["Go", "Kubernetes", "gRPC"],
    address: { city: "Denver", state: "CO", zip: "80201" },
    active: false,
  },
];

export const SEED_PRODUCTS = [
  {
    _id: new ObjectId("607f1f77bcf86cd799439021"),
    name: "CloudSync Pro",
    sku: "CSP-001",
    price: 29.99,
    category: "SaaS",
    inventory: 999,
    tags: ["cloud", "sync", "enterprise"],
    ratings: { average: 4.7, count: 1823 },
    createdAt: new Date("2024-01-10"),
  },
  {
    _id: new ObjectId("607f1f77bcf86cd799439022"),
    name: "DataVault Enterprise",
    sku: "DVE-002",
    price: 99.99,
    category: "Database",
    inventory: 500,
    tags: ["database", "backup", "enterprise"],
    ratings: { average: 4.3, count: 567 },
    createdAt: new Date("2024-03-15"),
  },
  {
    _id: new ObjectId("607f1f77bcf86cd799439023"),
    name: "APIGateway Lite",
    sku: "AGL-003",
    price: 0,
    category: "API",
    inventory: 9999,
    tags: ["api", "gateway", "free"],
    ratings: { average: 4.1, count: 3201 },
    createdAt: new Date("2023-09-01"),
  },
];

export const SEED_ORDERS = [
  {
    _id: new ObjectId("707f1f77bcf86cd799439031"),
    userId: new ObjectId("507f1f77bcf86cd799439011"),
    productId: new ObjectId("607f1f77bcf86cd799439021"),
    quantity: 5,
    totalAmount: 149.95,
    status: "completed",
    paymentMethod: "credit_card",
    createdAt: new Date("2024-06-15"),
    shippedAt: new Date("2024-06-16"),
  },
  {
    _id: new ObjectId("707f1f77bcf86cd799439032"),
    userId: new ObjectId("507f1f77bcf86cd799439012"),
    productId: new ObjectId("607f1f77bcf86cd799439022"),
    quantity: 1,
    totalAmount: 99.99,
    status: "pending",
    paymentMethod: "invoice",
    createdAt: new Date("2024-07-01"),
    shippedAt: null,
  },
  {
    _id: new ObjectId("707f1f77bcf86cd799439033"),
    userId: new ObjectId("507f1f77bcf86cd799439013"),
    productId: new ObjectId("607f1f77bcf86cd799439023"),
    quantity: 10,
    totalAmount: 0,
    status: "completed",
    paymentMethod: "free",
    createdAt: new Date("2024-05-20"),
    shippedAt: new Date("2024-05-20"),
  },
];

export const SEED_COLLECTIONS = {
  users: SEED_USERS,
  products: SEED_PRODUCTS,
  orders: SEED_ORDERS,
};
