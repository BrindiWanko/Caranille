<?php
$config = 'kernel/config.php';
$size = filesize($config);

//Si le fichier de configuration fait 0 octet c'est qu'il est vide, on redirige l'utilisateur vers l'installation
if ($size == 0) 
{
    header("Location: kernel/install/modules/step-1.php");
}
//Sinon on redirige l'utilisateur vers l'accueil du site
else
{
	header("Location: modules/main/index.php");
}
?>