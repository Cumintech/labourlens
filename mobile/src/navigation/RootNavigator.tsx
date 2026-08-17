import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import { ActivityIndicator, View } from "react-native";
import { OcrFields } from "../api/client";
import { useAuth } from "../context/AuthContext";
import DashboardScreen from "../screens/DashboardScreen";
import LoginScreen from "../screens/LoginScreen";
import NewWorkerDetailsScreen from "../screens/NewWorkerDetailsScreen";
import NewWorkerScanScreen from "../screens/NewWorkerScanScreen";
import ReportScreen from "../screens/ReportScreen";
import { colors } from "../theme";

export type RootStackParamList = {
  Dashboard: undefined;
  NewWorkerScan: undefined;
  NewWorkerDetails: { ocrFields: OcrFields };
  Report: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { token, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!token) {
    return <LoginScreen />;
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Dashboard"
        screenOptions={{
          headerStyle: { backgroundColor: colors.white },
          headerTitleStyle: { color: colors.navy, fontWeight: "700" },
          headerTintColor: colors.teal,
        }}
      >
        <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: "Dashboard" }} />
        <Stack.Screen name="NewWorkerScan" component={NewWorkerScanScreen} options={{ title: "New Worker" }} />
        <Stack.Screen
          name="NewWorkerDetails"
          component={NewWorkerDetailsScreen}
          options={{ title: "Worker Details" }}
        />
        <Stack.Screen name="Report" component={ReportScreen} options={{ title: "6-month report" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
